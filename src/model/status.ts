import { without } from './fields';

// 상태 (design §6.1): what a pack or a prompt declares a chat's state to hold, and the changes a reply made to it.
// Ids are made once and never reused: every value is kept by id, so a rename keeps it.
type Named = { id: string; name: string };

export type StatusItem = { text: string; done?: true };
export type StatusValue = number | string | StatusItem[];

// A colour by its role in the view's 분위기, which gives it a value: a field's colour then reads in every 분위기.
export type StatusTone = 'accent' | 'warm' | 'cool' | 'fresh';
// main (대표): drawn large, and what a collapsed panel keeps.
type Drawn = { main?: true; tone?: StatusTone };
// change: the writer gives the amount the number moved by, never its new value. unit: drawn after the number.
type Numeric = { start?: number; change?: true; unit?: string };
export type StatusField = Named &
  Drawn &
  (
    | ({ kind: 'gauge'; min: number; max: number } & Numeric)
    | ({ kind: 'number' } & Numeric)
    | { kind: 'text'; start?: string }
    | { kind: 'stage'; labels: string[]; start?: string }
    | { kind: 'list'; checked?: true; start?: StatusItem[] }
  );

// 묶음: records that share fields, each field's start being every member's. open: the writer adds and removes members.
// follows: a folder of the lorebook of the pack that declares it, by id, whose entries are records too, so an NPC added
// there has its record; a chat reads them in where it reads its definitions (engine/status rostered).
export type StatusGroup = Named & { fields: StatusField[]; members: Named[]; open?: true; follows?: { folder: string } };
// 기록: rows that accumulate, a turn adding to them. A row has no start.
export type StatusLog = Named & { fields: StatusField[] };
// after: a model of its own once the reply is saved. with: the conversation model, at its reply's end.
export type StatusWriter = 'after' | 'with';
export type StatusDefinition = Named & { writer: StatusWriter; fields: StatusField[]; groups: StatusGroup[]; logs: StatusLog[]; views?: StatusView[] };

// 보기 (design §6.1 part 4): a view arranges blocks that show the definition's fields, 묶음 and 기록 by id, in a 틀
// (how they are laid out) and a 분위기 (colours, type and corners). hazelle is the app's own colours in the reader's
// theme; own, the colours the reader picked for the app.
export type StatusFrame = 'card' | 'hud' | 'diary' | 'line';
export type StatusMood = 'hazelle' | 'own' | 'paper' | 'neon' | 'forest' | 'rose' | 'terminal';
export type StatusGaugeLook = 'bar' | 'segments' | 'ring' | 'hearts' | 'stars';
// A block naming what is no longer declared shows nothing, as a stale change changes nothing. look: a gauge's, a text
// drawn as a thought, or a 단계 drawn on the scale of its labels; absent, or one its field's kind does not take, the 틀
// decides. radar: three gauges or more as one shape. all: every row of the 기록, absent the latest reply's. choices: a
// list whose items go into the composer when pressed.
export type StatusBlock =
  | { kind: 'head'; fields: string[] }
  | { kind: 'field'; field: string; look?: StatusGaugeLook | 'thought' | 'scale' }
  | { kind: 'radar'; fields: string[] }
  | { kind: 'records'; group: string; look?: 'cards' | 'rows' | 'table' }
  | { kind: 'log'; log: string; all?: true }
  | { kind: 'choices'; field: string }
  | { kind: 'section'; name: string; blocks: StatusBlock[] }
  | { kind: 'tabs'; tabs: (Named & { blocks: StatusBlock[] })[] };
export type StatusView = Named & { frame: StatusFrame; mood: StatusMood; blocks: StatusBlock[] };

// 상태창 as the reader left it in a character's chats: folded, pinned at the story's top, and the view picked for a
// definition, both by id. Absent is open, after the latest reply, in the definition's first view.
export type StateShown = { folded?: true; pinned?: true; views?: Record<string, string> };
export type StateShow = { folded: boolean } | { pinned: boolean } | { view: { definition: string; view: string } };

export function stateShownWith(shown: StateShown, change: StateShow): StateShown {
  if ('view' in change) return { ...shown, views: { ...shown.views, [change.view.definition]: change.view.view } };
  const [key, on] = 'folded' in change ? (['folded', change.folded] as const) : (['pinned', change.pinned] as const);
  return on ? { ...shown, [key]: true } : without(shown, key);
}

export type StatusValues = Record<string, StatusValue>;
export type StatusMember = Named & { values: StatusValues };
export type StatusOf = { values: StatusValues; groups: Record<string, StatusMember[]>; logs: Record<string, StatusValues[]> };
// By definition id.
export type StatusState = Record<string, StatusOf>;

type In = { definition: string };
// member: a record of a group; absent, the definition's own fields.
export type StatusPlace = In & { field: string; member?: { group: string; id: string } };
export type StatusChange =
  | (StatusPlace & { kind: 'set'; value: StatusValue })
  | (StatusPlace & { kind: 'move'; by: number })
  | (In & { kind: 'join'; group: string; member: Named })
  | (In & { kind: 'leave'; group: string; member: string })
  | (In & { kind: 'row'; log: string; values: StatusValues });

// A chat's definitions in the order its prompt and packs declare them. A second one of an id (a copy attached beside
// its original) declares nothing, as a second toggle of a key does not (model/toggles chatToggles).
export function chatStatus(declared: readonly (StatusDefinition | undefined)[]): StatusDefinition[] {
  const ids = new Set<string>();
  return declared.flatMap((each) => (each && !ids.has(each.id) && ids.add(each.id) ? [each] : []));
}

// A definition's views; one that declares none is shown whole in one: its fields, then each 묶음 and each 기록.
export function statusViews(definition: StatusDefinition): StatusView[] {
  if (definition.views?.length) return definition.views;
  const blocks: StatusBlock[] = [
    ...definition.fields.map(({ id }) => ({ kind: 'field' as const, field: id })),
    ...definition.groups.map(({ id }) => ({ kind: 'records' as const, group: id })),
    ...definition.logs.map(({ id }) => ({ kind: 'log' as const, log: id })),
  ];
  return [{ id: definition.id, name: definition.name, frame: 'card', mood: 'hazelle', blocks }];
}

// A kept value read against the field as it stands now: undefined once it no longer fits the kind, and a gauge's held
// to its range, so narrowing a range loses no value.
function held(field: StatusField, value: StatusValue): StatusValue | undefined {
  switch (field.kind) {
    case 'gauge':
      return typeof value === 'number' ? Math.min(field.max, Math.max(field.min, value)) : undefined;
    case 'number':
      return typeof value === 'number' ? value : undefined;
    case 'text':
      return typeof value === 'string' ? value : undefined;
    case 'stage':
      return typeof value === 'string' && field.labels.includes(value) ? value : undefined;
    case 'list':
      return Array.isArray(value) ? value : undefined;
  }
}

function heldAll(fields: readonly StatusField[], values: StatusValues): StatusValues {
  return Object.fromEntries(
    fields.flatMap((field) => {
      const value = Object.hasOwn(values, field.id) ? held(field, values[field.id]!) : undefined;
      return value === undefined ? [] : [[field.id, value]];
    }),
  );
}

const starts = (fields: readonly StatusField[]): StatusValues => heldAll(fields, Object.fromEntries(fields.flatMap(({ id, start }) => (start === undefined ? [] : [[id, start]]))));

// What a number that was never set moves from.
const floor = (field: StatusField) => (field.kind === 'gauge' ? field.min : 0);

// The field a place names as the definition declares it now, with the values it stands among. undefined once the
// field, its 묶음 or its record is gone.
export function statusAt(definition: StatusDefinition, of: StatusOf, { field: named, member }: Pick<StatusPlace, 'field' | 'member'>): { field: StatusField; values: StatusValues; member?: StatusMember } | undefined {
  const record = member && of.groups[member.group]?.find(({ id }) => id === member.id);
  const fields = member ? definition.groups.find(({ id }) => id === member.group)?.fields : definition.fields;
  const field = fields?.find(({ id }) => id === named);
  if (!field || (member && !record)) return undefined;
  return { field, values: (record ?? of).values, ...(record && { member: record }) };
}

// Each definition's state before any change: its starts, its declared records, no rows.
const started = (definitions: readonly StatusDefinition[]): StatusState =>
  Object.fromEntries(
    definitions.map(({ id, fields, groups, logs }) => [
      id,
      {
        values: starts(fields),
        groups: Object.fromEntries(groups.map((group) => [group.id, group.members.map((member) => ({ ...member, values: starts(group.fields) }))])),
        logs: Object.fromEntries(logs.map((log) => [log.id, []])),
      },
    ]),
  );

// The changes, in order, made on the state. A change naming what is no longer declared, or holding a value its field
// no longer takes, changes nothing: no stored change is ever rewritten for a definition's edit.
function apply(definitions: readonly StatusDefinition[], state: StatusState, changes: Iterable<StatusChange>): void {
  for (const change of changes) {
    const definition = definitions.find(({ id }) => id === change.definition);
    const of = state[change.definition];
    if (!definition || !of) continue;
    if (change.kind === 'row') {
      const log = definition.logs.find(({ id }) => id === change.log);
      const row = log && heldAll(log.fields, change.values);
      if (row && Object.keys(row).length) of.logs[log.id]!.push(row);
      continue;
    }
    if (change.kind === 'join' || change.kind === 'leave') {
      const group = definition.groups.find(({ id }) => id === change.group);
      if (!group?.open) continue;
      const members = of.groups[group.id]!;
      if (change.kind === 'leave') of.groups[group.id] = members.filter(({ id }) => id !== change.member);
      else if (!members.some(({ id }) => id === change.member.id)) members.push({ ...change.member, values: starts(group.fields) });
      continue;
    }
    const at = statusAt(definition, of, change);
    if (!at) continue;
    const { field, values } = at;
    const now = values[field.id];
    const next = change.kind === 'set' ? held(field, change.value) : field.kind === 'gauge' || field.kind === 'number' ? held(field, (typeof now === 'number' ? now : floor(field)) + change.by) : undefined;
    if (next !== undefined) values[field.id] = next;
  }
}

// The state after the changes, in order, over each definition's starts.
export function statusAfter(definitions: readonly StatusDefinition[], changes: Iterable<StatusChange>): StatusState {
  const state = started(definitions);
  apply(definitions, state, changes);
  return state;
}

// A place's value along steps of changes, oldest first (a chat's shown versions): where it started (key null), then
// each step after which it stood differently. value is undefined where nothing is set, or the place's record is not
// there (not joined yet, or gone).
export type StatusStep<K> = { key: K | null; value: StatusValue | undefined };
export function statusCourse<K>(definitions: readonly StatusDefinition[], steps: Iterable<{ key: K; changes: readonly StatusChange[] }>, place: StatusPlace): StatusStep<K>[] {
  const definition = definitions.find(({ id }) => id === place.definition);
  if (!definition) return [];
  const state = started(definitions);
  const read = () => {
    const at = statusAt(definition, state[definition.id]!, place);
    return at?.values[at.field.id];
  };
  const same = (a: StatusValue | undefined, b: StatusValue | undefined) => a === b || (Array.isArray(a) && Array.isArray(b) && JSON.stringify(a) === JSON.stringify(b));
  const course: StatusStep<K>[] = [{ key: null, value: read() }];
  for (const { key, changes } of steps) {
    if (!changes.length) continue;
    apply(definitions, state, changes);
    const value = read();
    // A list is rewritten whole by each write, so read() hands back a new one: it is kept as it stood.
    if (!same(course.at(-1)!.value, value)) course.push({ key, value: Array.isArray(value) ? [...value] : value });
  }
  return course;
}
