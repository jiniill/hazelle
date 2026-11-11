import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { nameTaken } from '../../engine/status';
import { moved } from '../../model/fields';
import type { StatusBlock, StatusDefinition, StatusView } from '../../model/status';
import { blockNames, blocksAt, withBlocksAt, type BlockPath } from '../../model/statusEdit';
import { ACTS, addOf } from './acts';
import { blockWords, FIELD_LOOKS, STATUS_BLOCK, STATUS_LOOK, STATUS_RECORDS_LOOK, STATUS_WORDS } from './statusWords';
import { Button, Checkbox, ChoiceGroup, Dialog, Empty, List, ListItem, MenuItem, MoreMenu, PhraseField, SettingGroup, SettingRow, Stack, Switch, TextField } from '../ui';
import { MOVE, statusEdit } from './words';

type Props = { definition: StatusDefinition; view: StatusView; onChange: (blocks: StatusBlock[]) => void };

const AUTO = '';
const looks = <L extends string>(names: Record<L, string>, among: readonly L[]) => [{ value: AUTO as L | typeof AUTO, label: STATUS_WORDS.lookAuto }, ...among.map((value) => ({ value, label: names[value] }))];

const fieldLooks = (definition: StatusDefinition, block: Extract<StatusBlock, { kind: 'field' }>) => FIELD_LOOKS[definition.fields.find(({ id }) => id === block.field)?.kind ?? 'number'];
// A field drawn only as its 틀 draws it (a number, a list) has nothing to set.
const settable = (definition: StatusDefinition, block: StatusBlock) => block.kind !== 'field' || fieldLooks(definition, block) !== undefined;

// What a block can be set to, by its kind.
function settings(definition: StatusDefinition, block: StatusBlock, set: (next: StatusBlock) => void): ReactNode {
  const row = (label: string, control: ReactNode, help?: string) => <SettingRow label={label} help={help} control={control} />;
  const among = (fields: readonly { id: string; name: string }[], picked: readonly string[], pick: (ids: string[]) => void) => (
    <Stack gap="related">
      {fields.map(({ id, name }) => (
        <Checkbox key={id} label={name} checked={picked.includes(id)} onChange={(on) => pick(fields.filter((each) => (each.id === id ? on : picked.includes(each.id))).map((each) => each.id))} />
      ))}
    </Stack>
  );
  switch (block.kind) {
    case 'field': {
      const taken = fieldLooks(definition, block);
      return taken && <SettingGroup label={STATUS_WORDS.look}>{row(STATUS_WORDS.look, <ChoiceGroup label={STATUS_WORDS.look} layout="fit" options={looks(STATUS_LOOK, taken)} value={block.look ?? AUTO} onChange={(look) => set({ kind: 'field', field: block.field, ...(look && { look }) })} />)}</SettingGroup>;
    }
    case 'records':
      return <SettingGroup label={STATUS_WORDS.look}>{row(STATUS_WORDS.look, <ChoiceGroup label={STATUS_WORDS.look} layout="fit" options={looks(STATUS_RECORDS_LOOK, ['cards', 'rows', 'table'])} value={block.look ?? AUTO} onChange={(look) => set({ kind: 'records', group: block.group, ...(look && { look }) })} />)}</SettingGroup>;
    case 'log':
      return <SettingGroup label={STATUS_WORDS.all}>{row(STATUS_WORDS.all, <Switch label={STATUS_WORDS.all} checked={block.all === true} onChange={(all) => set({ kind: 'log', log: block.log, ...(all && { all }) })} />, STATUS_WORDS.allNote)}</SettingGroup>;
    case 'head':
      return among(definition.fields, block.fields, (fields) => set({ ...block, fields }));
    case 'radar':
      return among(definition.fields.filter(({ kind }) => kind === 'gauge'), block.fields, (fields) => set({ ...block, fields }));
    case 'choices':
      return <ChoiceGroup label={STATUS_WORDS.shows} layout="list" options={definition.fields.filter(({ kind }) => kind === 'list').map(({ id, name }) => ({ value: id, label: name }))} value={block.field} onChange={(field) => set({ ...block, field })} />;
    case 'section':
      return <TextField label={STATUS_WORDS.name} value={block.name} onChange={(name) => set({ ...block, name })} />;
    case 'tabs':
      // A tab keeps its blocks by its name; one taken out takes its blocks with it.
      return (
        <PhraseField
          label={STATUS_WORDS.tabNames}
          phrases={block.tabs.map(({ name }) => name)}
          onChange={(names) => set({ ...block, tabs: names.reduce<typeof block.tabs>((tabs, typed) => (!typed.trim() || nameTaken(tabs, typed) ? tabs : [...tabs, block.tabs.find(({ name }) => name === typed) ?? { id: crypto.randomUUID(), name: typed.trim(), blocks: [] }]), []) })}
        />
      );
  }
}

function BlockDialog({ definition, block, onSave, onClose }: { definition: StatusDefinition; block: StatusBlock; onSave: (block: StatusBlock) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(block);
  // A radar is a shape only from three axes on; a section needs its name, a tab block a tab.
  const short = (draft.kind === 'radar' && draft.fields.length < 3) || (draft.kind === 'section' && !draft.name.trim()) || (draft.kind === 'tabs' && draft.tabs.length === 0);
  return (
    <Dialog
      title={statusEdit(blockWords(definition, block).title)}
      note={draft.kind === 'radar' ? STATUS_WORDS.radarNote : undefined}
      onClose={onClose}
      onSubmit={() => onSave(draft.kind === 'section' ? { ...draft, name: draft.name.trim() } : draft)}
      actionsLayout="full"
      actions={
        <Button type="submit" disabled={short}>
          저장
        </Button>
      }
    >
      {settings(definition, draft, setDraft)}
    </Dialog>
  );
}

// What the view can take: each field, 묶음 and 기록 it does not show yet, then the blocks that arrange others.
function additions(definition: StatusDefinition, view: StatusView): { title: string; description: string; block: StatusBlock }[] {
  const shown = blockNames(view.blocks);
  const gauges = definition.fields.filter(({ kind }) => kind === 'gauge');
  const list = definition.fields.find(({ kind }) => kind === 'list');
  const blocks: StatusBlock[] = [
    ...definition.fields.filter(({ id }) => !shown.fields.has(id)).map(({ id }) => ({ kind: 'field' as const, field: id })),
    ...definition.groups.filter(({ id }) => !shown.groups.has(id)).map(({ id }) => ({ kind: 'records' as const, group: id })),
    ...definition.logs.filter(({ id }) => !shown.logs.has(id)).map(({ id }) => ({ kind: 'log' as const, log: id })),
    ...(definition.fields.length ? [{ kind: 'head' as const, fields: [] }] : []),
    ...(gauges.length >= 3 ? [{ kind: 'radar' as const, fields: gauges.map(({ id }) => id) }] : []),
    ...(list ? [{ kind: 'choices' as const, field: list.id }] : []),
    { kind: 'section', name: STATUS_BLOCK.section, blocks: [] },
    { kind: 'tabs', tabs: [{ id: crypto.randomUUID(), name: `${STATUS_BLOCK.tab} 1`, blocks: [] }] },
  ];
  return blocks.map((block) => ({ ...blockWords(definition, block), block }));
}

// A view's blocks (design §6.1 part 4) as rows in the order they are drawn, a section's and each tab's set in under
// it. A row opens what its block can be set to; its ⋯ moves it within its list, removes it, or adds inside it.
export function StatusBlocks({ definition, view, onChange }: Props) {
  const [adding, setAdding] = useState<BlockPath | null>(null);
  const [editing, setEditing] = useState<{ path: BlockPath; at: number } | null>(null);
  const change = (path: BlockPath, to: (list: readonly StatusBlock[]) => StatusBlock[]) => onChange(withBlocksAt(view.blocks, path, to));
  const inside = (path: BlockPath) => <MenuItem icon={ACTS.create.icon} label={STATUS_WORDS.inside} onClick={() => setAdding(path)} />;

  const rows = (path: BlockPath): ReactNode => {
    const list = blocksAt(view.blocks, path);
    return list.map((block, at) => {
      const { title, description } = blockWords(definition, block);
      return (
        <ListItem
          key={at}
          title={title}
          description={description}
          onClick={settable(definition, block) ? () => setEditing({ path, at }) : undefined}
          control={
            <MoreMenu of={`'${title}'`}>
              {block.kind === 'section' && inside([...path, { at }])}
              {at > 0 && <MenuItem icon={ArrowUp} label={MOVE.up} onClick={() => change(path, (blocks) => moved(blocks, at, at - 1))} />}
              {at < list.length - 1 && <MenuItem icon={ArrowDown} label={MOVE.down} onClick={() => change(path, (blocks) => moved(blocks, at, at + 1))} />}
              <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => change(path, (blocks) => blocks.filter((_, each) => each !== at))} />
            </MoreMenu>
          }
        >
          {block.kind === 'section' && rows([...path, { at }])}
          {block.kind === 'tabs' &&
            block.tabs.map((tab) => (
              <ListItem key={tab.id} title={tab.name} description={STATUS_BLOCK.tab} control={<MoreMenu of={`'${tab.name}'`}>{inside([...path, { at, tab: tab.id }])}</MoreMenu>}>
                {rows([...path, { at, tab: tab.id }])}
              </ListItem>
            ))}
        </ListItem>
      );
    });
  };

  const edited = editing && blocksAt(view.blocks, editing.path)[editing.at];
  return (
    <>
      {view.blocks.length > 0 ? <List box label={STATUS_WORDS.block}>{rows([])}</List> : <Empty variant="section">{STATUS_WORDS.noBlocks}</Empty>}
      <Button variant="secondary" icon={ACTS.create.icon} onClick={() => setAdding([])}>
        {addOf(STATUS_WORDS.block)}
      </Button>
      {adding && (
        <Dialog title={addOf(STATUS_WORDS.block)} onClose={() => setAdding(null)}>
          <List box label={addOf(STATUS_WORDS.block)}>
            {additions(definition, view).map(({ title, description, block }, at) => (
              <ListItem
                key={at}
                title={title}
                description={description}
                onClick={() => {
                  const end = blocksAt(view.blocks, adding).length;
                  change(adding, (blocks) => [...blocks, block]);
                  setAdding(null);
                  // What arranges others is set up as it is added: which fields, what name.
                  if (block.kind !== 'field' && block.kind !== 'records' && block.kind !== 'log') setEditing({ path: adding, at: end });
                }}
              />
            ))}
          </List>
        </Dialog>
      )}
      {editing && edited && (
        <BlockDialog
          definition={definition}
          block={edited}
          onClose={() => setEditing(null)}
          onSave={(block) => {
            setEditing(null);
            change(editing.path, (blocks) => blocks.map((each, at) => (at === editing.at ? block : each)));
          }}
        />
      )}
    </>
  );
}
