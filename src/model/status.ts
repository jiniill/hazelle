// 상태 (design §6.1): what a pack or a prompt declares a chat's state to hold, and the changes a reply made to it.
// Ids are made once and never reused: every value is kept by id, so a rename keeps it.
type Named = { id: string; name: string };

export type StatusItem = { text: string; done?: true };
export type StatusValue = number | string | StatusItem[];

// change: the writer gives the amount the number moved by, never its new value.
type Numeric = { start?: number; change?: true };
export type StatusField = Named &
  (
    | ({ kind: 'gauge'; min: number; max: number } & Numeric)
    | ({ kind: 'number' } & Numeric)
    | { kind: 'text'; start?: string }
    | { kind: 'stage'; labels: string[]; start?: string }
    | { kind: 'list'; checked?: true; start?: StatusItem[] }
  );

// 묶음: records that share fields, each field's start being every member's. open: the writer adds and removes members.
export type StatusGroup = Named & { fields: StatusField[]; members: Named[]; open?: true };
// 기록: rows that accumulate, a turn adding to them. A row has no start.
export type StatusLog = Named & { fields: StatusField[] };
// after: a model of its own once the reply is saved. with: the conversation model, at its reply's end.
export type StatusWriter = 'after' | 'with';
export type StatusDefinition = Named & { writer: StatusWriter; fields: StatusField[]; groups: StatusGroup[]; logs: StatusLog[] };

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

// The state after the changes, in order, over each definition's starts. A change naming what is no longer declared, or
// holding a value its field no longer takes, changes nothing: no stored change is ever rewritten for a definition's edit.
export function statusAfter(definitions: readonly StatusDefinition[], changes: Iterable<StatusChange>): StatusState {
  const state: StatusState = Object.fromEntries(
    definitions.map(({ id, fields, groups, logs }) => [
      id,
      {
        values: starts(fields),
        groups: Object.fromEntries(groups.map((group) => [group.id, group.members.map((member) => ({ ...member, values: starts(group.fields) }))])),
        logs: Object.fromEntries(logs.map((log) => [log.id, []])),
      },
    ]),
  );
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
    const group = change.member && definition.groups.find(({ id }) => id === change.member!.group);
    const values = change.member ? of.groups[change.member.group]?.find(({ id }) => id === change.member!.id)?.values : of.values;
    const field = (group ? group.fields : change.member ? [] : definition.fields).find(({ id }) => id === change.field);
    if (!field || !values) continue;
    const now = values[field.id];
    const next = change.kind === 'set' ? held(field, change.value) : field.kind === 'gauge' || field.kind === 'number' ? held(field, (typeof now === 'number' ? now : floor(field)) + change.by) : undefined;
    if (next !== undefined) values[field.id] = next;
  }
  return state;
}
