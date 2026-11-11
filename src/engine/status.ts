import type { StatusChange, StatusDefinition, StatusField, StatusGroup, StatusItem, StatusLog, StatusMember, StatusPlace, StatusState, StatusValue, StatusValues, StatusWriter } from '../model/status';

// The layout statusText writes, statusAsk describes and parseStatus reads is one contract (design §6.1): a "# name"
// line per definition, "## name" per group or log, "### name" per record, "name: value" per field, "- item" per list
// item or one-field row. It is never stored, so it may change without touching a chat.

// The newest rows of a log a writer is told; all of them are kept.
const LOG_TOLD = 20;

const itemLine = (checked: boolean, { text, done }: StatusItem) => (checked ? `- [${done ? 'x' : ' '}] ${text}` : `- ${text}`);

function fieldLines(fields: readonly StatusField[], values: StatusValues): string[] {
  return fields.flatMap((field) => {
    const value = values[field.id];
    if (value === undefined) return [];
    return Array.isArray(value) ? [`${field.name}:`, ...value.map((item) => itemLine(field.kind === 'list' && field.checked === true, item))] : [`${field.name}: ${value}`];
  });
}

// A log of one field that is no list writes each row as an item line.
const lone = ({ fields }: StatusLog) => (fields.length === 1 && fields[0]!.kind !== 'list' ? fields[0]! : undefined);

function rowLines(log: StatusLog, row: StatusValues): string[] {
  const field = lone(log);
  return field ? (row[field.id] === undefined ? [] : [`- ${String(row[field.id])}`]) : ['### +', ...fieldLines(log.fields, row)];
}

// The state as it stands, a field never set left out.
export function statusText(definitions: readonly StatusDefinition[], state: StatusState): string {
  return definitions
    .flatMap((definition) => {
      const of = state[definition.id];
      if (!of) return [];
      return [
        `# ${definition.name}`,
        ...fieldLines(definition.fields, of.values),
        ...definition.groups.flatMap((group) => [`## ${group.name}`, ...(of.groups[group.id] ?? []).flatMap((member) => [`### ${member.name}`, ...fieldLines(group.fields, member.values)])]),
        ...definition.logs.flatMap((log) => [`## ${log.name}`, ...(of.logs[log.id] ?? []).slice(-LOG_TOLD).flatMap((row) => rowLines(log, row))]),
      ];
    })
    .join('\n');
}

function fieldRule(field: StatusField): string {
  switch (field.kind) {
    case 'gauge':
      return field.change ? `the amount it moved by this turn with its sign, such as +3 or -2; it stays from ${field.min} to ${field.max}` : `a number from ${field.min} to ${field.max}`;
    case 'number':
      return field.change ? 'the amount it moved by this turn with its sign, such as +3 or -2' : 'a number';
    case 'text':
      return 'text on one line';
    case 'stage':
      return `one of: ${field.labels.join(', ')}`;
    case 'list':
      return field.checked ? 'a list, "- [x] item" for one that is done and "- [ ] item" for one that is not' : 'a list';
  }
}

const rules = (fields: readonly StatusField[]) => fields.map((field) => `- ${field.name}: ${fieldRule(field)}`);

// What the writer of these definitions is asked for, to follow the state statusText told it.
export function statusAsk(definitions: readonly StatusDefinition[]): string {
  return [
    'Write what this turn changed inside <status></status>, in the layout of the status above: its "# name" line, the "## name" line of a group or a log, the "### name" line of a record, then one "name: value" line for each field that changed. Leave out every field that did not change.',
    'A list is its name and a colon, then one "- item" line for each item it holds now, all of them.',
    'A group that takes new records gets one by a "### name" line of its own, and loses one by "### name (remove)".',
    'Under a log write only the rows this turn adds, never an earlier one: a "- text" line each, or a "### +" line followed by the row\'s fields when it has several.',
    'The fields:',
    ...definitions.flatMap((definition) => [
      `# ${definition.name}`,
      ...rules(definition.fields),
      ...definition.groups.flatMap((group) => [`## ${group.name} (a group${group.open ? ' that takes new records' : ''})`, ...rules(group.fields)]),
      ...definition.logs.flatMap((log) => [`## ${log.name} (a log)`, ...rules(log.fields)]),
    ]),
  ].join('\n');
}

// What a writer is sent: the whole state, then the ask for the definitions it writes. Empty when nothing is declared.
export function statusSent(definitions: readonly StatusDefinition[], state: StatusState, writer: StatusWriter): string {
  if (!definitions.length) return '';
  const asked = definitions.filter((each) => each.writer === writer);
  return [`The status as it stands:\n${statusText(definitions, state)}`, ...(asked.length ? [statusAsk(asked)] : [])].join('\n\n');
}

const BLOCK = /<status>([\s\S]*?)(<\/status>|$)/giu;
// A reply's text with no block in it, one still being written included: what is shown of a reply while it streams.
export const withoutStatus = (text: string) => text.replace(BLOCK, '').trimEnd();

const HEADING = /^(#{1,3})\s*(.*)$/u;
const ITEM = /^[-*]\s+(.*)$/u;
const DONE = /^\[([ xX])\]\s*(.*)$/u;
const PAIR = /^(?:[-*]\s+)?\**\s*(.+?)\s*\**\s*[:：]\s*(.*)$/u;
const REMOVE = /\s*\(remove\)$/iu;
// A number, then at most its ceiling ("84/120") and a unit: any other digit after it makes the line unreadable.
const NUMBER = /^([+-]?\d[\d,]*(?:\.\d+)?)(?:\s*\/\s*\d[\d,.]*)?\D*$/u;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const equal = (a: StatusValue | undefined, b: StatusValue) => JSON.stringify(a) === JSON.stringify(b);

// undefined: the text is not a value this field takes. A change field's number is its amount, which has no range and
// must carry its sign: the value the writer was told, written back, is then unreadable instead of a huge move.
function read(field: StatusField, text: string): StatusValue | undefined {
  switch (field.kind) {
    case 'gauge':
    case 'number': {
      const digits = NUMBER.exec(text)?.[1];
      if (digits === undefined) return undefined;
      const number = Number(digits.replaceAll(',', ''));
      if (field.change) return number === 0 || /^[+-]/u.test(digits) ? number : undefined;
      return field.kind === 'gauge' && (number < field.min || number > field.max) ? undefined : number;
    }
    case 'text':
      return text;
    case 'stage':
      return field.labels.find((label) => same(label, text));
    // Its items follow on their own lines; anything on its own line is not a list.
    case 'list':
      return undefined;
  }
}

function itemOf(text: string): StatusItem {
  const done = DONE.exec(text);
  return done ? { text: done[2]!.trim(), ...(done[1] !== ' ' && { done: true as const }) } : { text: text.trim() };
}

type Target = { fields: readonly StatusField[]; put: (field: StatusField, value: StatusValue | undefined) => void };

// found: false when the reply holds no block or its last one is not closed (a reply cut short), which leaves the state
// as it was. unread: fields whose line was there and could not be read. text: the reply without its blocks.
export type StatusRead = { text: string; found: boolean; changes: StatusChange[]; unread: StatusPlace[] };

// state: what the writer was told, which a line repeating it does not change. mint: a new record's id.
export function parseStatus(text: string, definitions: readonly StatusDefinition[], state: StatusState, mint: () => string): StatusRead {
  const last = [...text.matchAll(BLOCK)].at(-1);
  const changes: StatusChange[] = [];
  const unread: StatusPlace[] = [];
  const answer = { text: text.replace(BLOCK, '').trim(), changes, unread };
  if (!last?.[2]) return { ...answer, found: false };

  const rosters = new Map<StatusGroup, StatusMember[]>();
  let definition = definitions[0];
  let section: { group: StatusGroup } | { log: StatusLog } | undefined;
  let target: Target | undefined;
  let list: { items: StatusItem[]; close: () => void } | undefined;
  let row: { log: StatusLog; values: StatusValues } | undefined;

  const fieldsAt = (fields: readonly StatusField[], now: StatusValues, at: (field: string) => StatusPlace): Target => ({
    fields,
    put: (field, value) => {
      const place = at(field.id);
      if (value === undefined) unread.push(place);
      else if ((field.kind === 'gauge' || field.kind === 'number') && field.change) {
        if (typeof value === 'number' && value !== 0) changes.push({ ...place, kind: 'move', by: value });
      } else if (!equal(now[field.id], value)) changes.push({ ...place, kind: 'set', value });
    },
  });
  const own = (of: StatusDefinition) => fieldsAt(of.fields, state[of.id]?.values ?? {}, (field) => ({ definition: of.id, field }));
  const record = (of: StatusDefinition, group: StatusGroup, heading: string): Target | undefined => {
    const name = heading.replace(REMOVE, '').trim();
    const roster = rosters.get(group) ?? [...(state[of.id]?.groups[group.id] ?? [])];
    rosters.set(group, roster);
    let member = roster.find((each) => same(each.name, name));
    if (REMOVE.test(heading)) {
      if (member && group.open) {
        changes.push({ definition: of.id, kind: 'leave', group: group.id, member: member.id });
        roster.splice(roster.indexOf(member), 1);
      }
      return undefined;
    }
    if (!member) {
      if (!group.open || !name) return undefined;
      member = { id: mint(), name, values: {} };
      roster.push(member);
      changes.push({ definition: of.id, kind: 'join', group: group.id, member: { id: member.id, name } });
    }
    const { id, values } = member;
    return fieldsAt(group.fields, values, (field) => ({ definition: of.id, field, member: { group: group.id, id } }));
  };
  // A row the writer was already told is not added again.
  const add = (log: StatusLog, values: StatusValues) => {
    const told = (definition && state[definition.id]?.logs[log.id]) ?? [];
    if (definition && Object.keys(values).length && !told.some((each) => JSON.stringify(each) === JSON.stringify(values))) changes.push({ definition: definition.id, kind: 'row', log: log.id, values });
  };
  const close = () => {
    list?.close();
    list = undefined;
  };
  const closeRow = () => {
    if (row) add(row.log, row.values);
    row = undefined;
  };

  target = definition && own(definition);
  for (const line of last[1]!.split('\n').map((each) => each.trim())) {
    if (!line) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      closeRow();
      const name = heading[2]!;
      if (heading[1]!.length === 1) {
        definition = definitions.find((each) => same(each.name, name));
        section = undefined;
        target = definition && own(definition);
      } else if (heading[1]!.length === 2) {
        const group = definition?.groups.find((each) => same(each.name, name));
        const log = definition?.logs.find((each) => same(each.name, name));
        section = group ? { group } : log ? { log } : undefined;
        target = undefined;
      } else if (definition && section && 'group' in section) target = record(definition, section.group, name);
      else if (section && 'log' in section) {
        const values: StatusValues = {};
        row = { log: section.log, values };
        target = { fields: section.log.fields, put: (field, value) => void (value !== undefined && (values[field.id] = value)) };
      } else target = undefined;
      continue;
    }
    const item = ITEM.exec(line);
    if (item && list) {
      list.items.push(itemOf(item[1]!));
      continue;
    }
    close();
    const field = item && !row && section && 'log' in section ? lone(section.log) : undefined;
    if (item && field && section && 'log' in section) {
      const value = read(field, item[1]!.trim());
      if (value !== undefined) add(section.log, { [field.id]: value });
      continue;
    }
    const pair = PAIR.exec(line);
    const named = pair && target?.fields.find(({ name }) => same(name, pair[1]!));
    if (!pair || !named || !target) continue;
    const value = pair[2]!.replace(/^\*+\s*/u, '').trim();
    if (named.kind === 'list' && value === '') {
      const items: StatusItem[] = [];
      const { put } = target;
      list = { items, close: () => put(named, items) };
    } else target.put(named, read(named, value));
  }
  close();
  closeRow();
  return { ...answer, found: true };
}
