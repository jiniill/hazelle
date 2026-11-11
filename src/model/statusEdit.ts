import { without } from './fields';
import { statusViews, type StatusBlock, type StatusDefinition, type StatusField, type StatusView } from './status';

// A definition as its editor changes it (design §6.1 part 1). An id is the caller's, made once; nothing here makes one.

// Where a list of fields stands: the definition's own, a 묶음's or a 기록's.
export type FieldList = { of: 'definition' } | { of: 'group' | 'log'; id: string };

const holder = (list: Exclude<FieldList, { of: 'definition' }>) => (list.of === 'group' ? 'groups' : 'logs');

export const fieldsOf = (definition: StatusDefinition, list: FieldList): StatusField[] =>
  list.of === 'definition' ? definition.fields : (definition[holder(list)].find(({ id }) => id === list.id)?.fields ?? []);

const mapBlocks = (blocks: readonly StatusBlock[], change: (block: StatusBlock) => StatusBlock | undefined): StatusBlock[] =>
  blocks.flatMap((block): StatusBlock[] => {
    const next = change(block);
    if (!next) return [];
    if (next.kind === 'section') return [{ ...next, blocks: mapBlocks(next.blocks, change) }];
    if (next.kind === 'tabs') return [{ ...next, tabs: next.tabs.map((tab) => ({ ...tab, blocks: mapBlocks(tab.blocks, change) })) }];
    return [next];
  });

const viewsWith = (definition: StatusDefinition, change: (view: StatusView) => StatusView): StatusDefinition =>
  definition.views ? { ...definition, views: definition.views.map(change) } : definition;

// What is declared anew joins each view the definition declares, at its end: a view shows only what its blocks name.
const shownIn = (definition: StatusDefinition, block: StatusBlock) => viewsWith(definition, (view) => ({ ...view, blocks: [...view.blocks, block] }));

// What is gone leaves the views with it, a line of several (a head, a radar) keeping the rest.
const goneFrom = (definition: StatusDefinition, what: 'field' | 'group' | 'log', id: string) =>
  viewsWith(definition, (view) => ({
    ...view,
    blocks: mapBlocks(view.blocks, (block) => {
      if (what === 'field' && (block.kind === 'head' || block.kind === 'radar')) return { ...block, fields: block.fields.filter((each) => each !== id) };
      if (what === 'field') return (block.kind === 'field' || block.kind === 'choices') && block.field === id ? undefined : block;
      if (what === 'group') return block.kind === 'records' && block.group === id ? undefined : block;
      return block.kind === 'log' && block.log === id ? undefined : block;
    }),
  }));

// The list with its fields changed. A field of the definition's own that is new or gone joins or leaves the views; a
// 묶음's and a 기록's fields are drawn by their one block.
export function withFields(definition: StatusDefinition, list: FieldList, fields: StatusField[]): StatusDefinition {
  if (list.of !== 'definition') {
    const key = holder(list);
    return { ...definition, [key]: definition[key].map((each) => (each.id === list.id ? { ...each, fields } : each)) };
  }
  const added = fields.filter(({ id }) => !definition.fields.some((each) => each.id === id));
  const gone = definition.fields.filter(({ id }) => !fields.some((each) => each.id === id));
  const joined = added.reduce((to, { id }) => shownIn(to, { kind: 'field', field: id }), { ...definition, fields });
  return gone.reduce((from, { id }) => goneFrom(from, 'field', id), joined);
}

export const withGroup = (definition: StatusDefinition, id: string, name: string): StatusDefinition =>
  shownIn({ ...definition, groups: [...definition.groups, { id, name, fields: [], members: [], open: true }] }, { kind: 'records', group: id });

export const withLog = (definition: StatusDefinition, id: string, name: string): StatusDefinition =>
  shownIn({ ...definition, logs: [...definition.logs, { id, name, fields: [] }] }, { kind: 'log', log: id });

export const withoutGroup = (definition: StatusDefinition, id: string): StatusDefinition =>
  goneFrom({ ...definition, groups: definition.groups.filter((each) => each.id !== id) }, 'group', id);

export const withoutLog = (definition: StatusDefinition, id: string): StatusDefinition =>
  goneFrom({ ...definition, logs: definition.logs.filter((each) => each.id !== id) }, 'log', id);

// A view of its own, under the id given: everything the definition holds, as one that declares no view is shown.
export const withView = (definition: StatusDefinition, id: string, name: string): StatusDefinition => ({
  ...definition,
  views: [...(definition.views ?? []), { ...statusViews(without(definition, 'views'))[0]!, id, name }],
});

// Without its last view it declares none again, and is shown whole.
export function withoutView(definition: StatusDefinition, id: string): StatusDefinition {
  const views = (definition.views ?? []).filter((each) => each.id !== id);
  return views.length ? { ...definition, views } : without(definition, 'views');
}
