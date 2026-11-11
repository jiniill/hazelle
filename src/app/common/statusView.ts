import type { StatusBlock, StatusDefinition, StatusField, StatusMember, StatusOf, StatusPlace, StatusStep, StatusValue, StatusValues, StatusView } from '../../model/status';
import { STATUS_FRAME, STATUS_MOOD, type ShownBlock, type ShownField, type ShownRecord, type StatusDelta, type StatusFrame, type StatusMood } from '../ui';

// 상태's views as the kit draws them (design §6.1 part 4): the one place a definition and a state become what is shown,
// for the panel, 상세 and whatever shows the state later.

export type ShownView = { id: string; name: string; frame: StatusFrame; mood: StatusMood; blocks: ShownBlock[] };

// How many cells a gauge of cells draws: one a step where its range is a few whole steps, else ten.
const CELLS = 10;
const MOST_STEPS = 12;
// Fewer axes make no shape.
const RADAR_FROM = 3;

const figure = (value: number) => value.toLocaleString('ko-KR');
const withUnit = (text: string, unit: string | undefined) => (unit ? `${text} ${unit}` : text);
const signed = (by: number) => `${by > 0 ? '+' : '-'}${figure(Math.abs(by))}`;

function deltaOf(now: StatusValue | undefined, before: StatusValues | undefined, id: string): StatusDelta | undefined {
  const was = before?.[id];
  if (typeof now !== 'number' || typeof was !== 'number' || now === was) return undefined;
  return { text: signed(now - was), down: now < was };
}

type Look = Extract<StatusBlock, { kind: 'field' }>['look'];

// before: the same values as they stood before the latest reply; absent, nothing is shown as moved.
function shownField(field: StatusField, values: StatusValues, before: StatusValues | undefined, look?: Look): ShownField {
  const value = values[field.id];
  const common = { id: field.id, name: field.name, ...(field.main && { main: true }), ...(field.tone && { tone: field.tone }) };
  switch (field.kind) {
    case 'gauge': {
      const span = field.max - field.min;
      const set = typeof value === 'number';
      const delta = deltaOf(value, before, field.id);
      return {
        ...common,
        kind: 'gauge',
        look: look && look !== 'thought' && look !== 'scale' ? look : 'bar',
        share: set && span > 0 ? (value - field.min) / span : 0,
        ...(field.min < 0 && field.max > 0 && { zero: -field.min / span }),
        steps: Number.isInteger(span) && span > 0 && span <= MOST_STEPS ? span : CELLS,
        value: set ? figure(value) : '',
        max: withUnit(figure(field.max), field.unit),
        ...(delta && { delta }),
      };
    }
    case 'number': {
      const delta = deltaOf(value, before, field.id);
      return { ...common, kind: 'number', value: typeof value === 'number' ? withUnit(figure(value), field.unit) : '', ...(delta && { delta }) };
    }
    case 'text':
      return { ...common, kind: 'text', value: typeof value === 'string' ? value : '', ...(look === 'thought' && { thought: true }) };
    case 'stage':
      return { ...common, kind: 'stage', value: typeof value === 'string' ? value : '', labels: field.labels, ...(look === 'scale' && { scale: true }) };
    case 'list':
      return { ...common, kind: 'list', items: Array.isArray(value) ? value.map(({ text, done }) => ({ text, ...(done && { done }) })) : [], ...(field.checked && { checked: true }) };
  }
}

// A value as a few words: a 기록's cell, a head's item, a choice.
function words(field: StatusField, value: StatusValue | undefined): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.map(({ text }) => text).join(', ');
  return typeof value === 'number' ? withUnit(figure(value), field.kind === 'gauge' || field.kind === 'number' ? field.unit : undefined) : value;
}

const found = <T>(items: (T | undefined)[]): T[] => items.filter((item): item is T => item !== undefined);

function shownBlocks(definition: StatusDefinition, blocks: readonly StatusBlock[], now: StatusOf, before: StatusOf | undefined, path: string): ShownBlock[] {
  const fieldOf = (id: string) => definition.fields.find((field) => field.id === id);
  return blocks.flatMap((block, index): ShownBlock[] => {
    const id = `${path}${index}`;
    switch (block.kind) {
      case 'field': {
        const field = fieldOf(block.field);
        return field ? [{ block: 'field', field: shownField(field, now.values, before?.values, block.look) }] : [];
      }
      case 'head': {
        const items = found(block.fields.map(fieldOf)).flatMap((field) => {
          const value = words(field, now.values[field.id]);
          return value ? [{ id: field.id, name: field.name, value }] : [];
        });
        return items.length ? [{ block: 'head', id, items }] : [];
      }
      case 'radar': {
        const axes = found(block.fields.map(fieldOf)).flatMap((field) => {
          const shown = shownField(field, now.values, undefined);
          return shown.kind === 'gauge' ? [{ id: field.id, name: field.name, share: shown.share, value: shown.value }] : [];
        });
        return axes.length >= RADAR_FROM ? [{ block: 'radar', id, axes }] : axes.map((axis) => ({ block: 'field' as const, field: shownField(fieldOf(axis.id)!, now.values, before?.values) }));
      }
      case 'records': {
        const group = definition.groups.find((each) => each.id === block.group);
        const members: StatusMember[] = group ? (now.groups[group.id] ?? []) : [];
        if (!group || !members.length) return [];
        const was = (member: string) => before?.groups[group.id]?.find((each) => each.id === member)?.values;
        const shown: ShownRecord[] = members.map((member) => ({ id: member.id, name: member.name, fields: group.fields.map((field) => shownField(field, member.values, was(member.id))) }));
        return [{ block: 'records', id: group.id, name: group.name, look: block.look ?? 'cards', columns: group.fields.map(({ id: field, name }) => ({ id: field, name })), members: shown }];
      }
      case 'log': {
        const log = definition.logs.find((each) => each.id === block.log);
        const all = log ? (now.logs[log.id] ?? []) : [];
        // The latest reply's rows are those past what stood before it.
        const rows = block.all || !before ? all : all.slice(before.logs[log?.id ?? '']?.length ?? 0);
        if (!log || !rows.length) return [];
        return [{ block: 'log', id: log.id, name: log.name, columns: log.fields.map(({ id: field, name }) => ({ id: field, name })), rows: rows.map((row) => log.fields.map((field) => words(field, row[field.id]))) }];
      }
      case 'choices': {
        const field = fieldOf(block.field);
        const value = field && now.values[field.id];
        const items = Array.isArray(value) ? value.map(({ text }) => text) : [];
        return field && items.length ? [{ block: 'choices', id: field.id, name: field.name, items }] : [];
      }
      case 'section': {
        const inner = shownBlocks(definition, block.blocks, now, before, `${id}.`);
        return inner.length ? [{ block: 'section', id, name: block.name, blocks: inner }] : [];
      }
      case 'tabs': {
        const tabs = block.tabs.map((tab) => ({ id: tab.id, name: tab.name, blocks: shownBlocks(definition, tab.blocks, now, before, `${id}.${tab.id}.`) })).filter((tab) => tab.blocks.length > 0);
        return tabs.length ? [{ block: 'tabs', id, tabs }] : [];
      }
      default:
        return [];
    }
  });
}

// The 대표 fields of a definition, which a folded panel keeps.
export const shownMain = (definition: StatusDefinition, now: StatusOf, before?: StatusOf): ShownField[] =>
  definition.fields.filter(({ main }) => main).map((field) => shownField(field, now.values, before?.values));

// The whole state of a definition, whatever its views show (상세): every field, each 묶음 a line a record, each 기록
// with all its rows.
export const shownWhole = (definition: StatusDefinition, now: StatusOf, before?: StatusOf): ShownBlock[] =>
  shownBlocks(
    definition,
    [
      ...definition.fields.map(({ id }): StatusBlock => ({ kind: 'field', field: id })),
      ...definition.groups.map(({ id }): StatusBlock => ({ kind: 'records', group: id, look: 'rows' })),
      ...definition.logs.map(({ id }): StatusBlock => ({ kind: 'log', log: id, all: true })),
    ],
    now,
    before,
    'whole.',
  );

type At = Partial<Pick<StatusPlace, 'field' | 'member'>>;
const fieldsAt = (definition: StatusDefinition, { member }: At) => (member ? definition.groups.find(({ id }) => id === member.group)?.fields : definition.fields);

// One record as its card, or one field alone (a record's inside its record's card): a page of its own in 상세. Nothing
// once it is gone.
export function shownAt(definition: StatusDefinition, now: StatusOf, before: StatusOf | undefined, { field, member }: At): ShownBlock[] {
  if (!member) {
    const own = definition.fields.find(({ id }) => id === field);
    return own ? [{ block: 'field', field: { ...shownField(own, now.values, before?.values), main: true } }] : [];
  }
  return shownBlocks(definition, [{ kind: 'records', group: member.group, look: 'cards' }], now, before, 'at.').map((block) =>
    block.block === 'records' ? { ...block, members: block.members.filter(({ id }) => id === member.id).map((each) => ({ ...each, fields: each.fields.filter(({ id }) => field === undefined || id === field) })) } : block,
  ).filter((block) => block.block !== 'records' || block.members.length > 0);
}

// A place's course as words, oldest first: each value it took, with what a number moved by from the one before. key
// null is where it started.
export type ShownStep = { key: string | null; value: string; delta?: StatusDelta };
export function shownCourse(definition: StatusDefinition, steps: readonly StatusStep<string>[], place: At): ShownStep[] {
  const field = fieldsAt(definition, place)?.find(({ id }) => id === place.field);
  if (!field) return [];
  return steps.map(({ key, value }, index) => {
    const was = steps[index - 1]?.value;
    const delta = typeof value === 'number' && typeof was === 'number' ? { text: signed(value - was), down: value < was } : undefined;
    return { key, value: words(field, value), ...(delta && { delta }) };
  });
}

// A view of a definition over its state. A block that names what is no longer declared, or has nothing to show (a 묶음
// with no record, a 기록 the latest reply added no row to), is left out; a 틀 or a 분위기 this build does not know
// is drawn as a card in the app's colours.
export function shownView(definition: StatusDefinition, view: StatusView, now: StatusOf, before?: StatusOf): ShownView {
  return {
    id: view.id,
    name: view.name,
    frame: Object.hasOwn(STATUS_FRAME, view.frame) ? view.frame : 'card',
    mood: Object.hasOwn(STATUS_MOOD, view.mood) ? view.mood : 'hazelle',
    blocks: shownBlocks(definition, view.blocks, now, before, ''),
  };
}
