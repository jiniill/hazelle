import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { nameTaken, rostered, type RosterEntry } from '../../engine/status';
import { moved, without } from '../../model/fields';
import type { LoreFolder } from '../../model/library';
import { statusViews, type StatusApp, type StatusDefinition, type StatusField, type StatusFrame, type StatusMood, type StatusView, type StatusWriter } from '../../model/status';
import { fieldsOf, withFields, withGroup, withLog, withoutGroup, withoutLog, withoutView, withView, type FieldList } from '../../model/statusEdit';
import { blankStatus, fromType, STATUS_TYPES } from '../../model/statusTypes';
import { useDisplay } from '../display';
import { useToast } from '../toast';
import { ACTS, addOf } from './acts';
import { NameDialog } from './NameDialog';
import { StatusBlocks } from './StatusBlocks';
import type { FieldKind } from './statusDraft';
import { StatusFieldDialog } from './StatusFieldDialog';
import { sampleState } from './statusSample';
import { shownApp, shownView } from './statusView';
import { fieldSummary, STATUS_KIND, STATUS_KINDS, STATUS_PROBLEM, STATUS_WORDS, STATUS_WRITER } from './statusWords';
import { Button, ChoiceGroup, ConfirmDialog, Empty, List, ListItem, Menu, MenuItem, MoreMenu, PhraseField, Section, SettingGroup, SettingRow, Stack, STATUS_APP, STATUS_FRAME, STATUS_MOOD, StatusPanel, StatusPhone, Switch, Text, TextField } from '../ui';
import { MOVE, STATUS, statusTaken, PHONE } from './words';

type Change = (next: StatusDefinition) => void;
// The lorebook of the pack that declares the definition; a prompt has none.
type Lore = { folders: readonly LoreFolder[]; entries: readonly RosterEntry[] };
type Props = {
  definition: StatusDefinition | undefined;
  // undefined: the definition removed.
  onChange: (next: StatusDefinition | undefined) => void;
  // Its name as it is typed; unnamed, it is kept on screen and not saved.
  onType: (next: StatusDefinition, valid: boolean) => void;
  lore?: Lore;
};

const BLANK = 'blank';
const WRITERS = (Object.keys(STATUS_WRITER) as StatusWriter[]).map((value) => ({ value, label: STATUS_WRITER[value].label }));
const options = <K extends string>(names: Record<K, string>) => (Object.keys(names) as K[]).map((value) => ({ value, label: names[value] }));

function Start({ onStart }: { onStart: Change }) {
  return (
    <Section title={STATUS}>
      <Empty variant="section">{STATUS_WORDS.none}</Empty>
      <ChoiceGroup
        label={STATUS_WORDS.types}
        showLabel
        layout="cards"
        options={[...STATUS_TYPES.map(({ id, name, description }) => ({ value: id, label: name, description })), { value: BLANK, label: STATUS_WORDS.blank, description: STATUS_WORDS.blankNote }]}
        value={null}
        onChange={(picked) => {
          const type = STATUS_TYPES.find(({ id }) => id === picked);
          onStart(type ? fromType(type, crypto.randomUUID()) : blankStatus(crypto.randomUUID(), STATUS));
        }}
      />
    </Section>
  );
}

// One list of fields: the definition's own, a 묶음's or a 기록's. A row opens its form.
function Fields({ definition, list, onChange }: { definition: StatusDefinition; list: FieldList; onChange: Change }) {
  const [editing, setEditing] = useState<{ kind: FieldKind; field?: StatusField } | null>(null);
  const fields = fieldsOf(definition, list);
  const write = (next: StatusField[]) => onChange(withFields(definition, list, next));
  return (
    <>
      {fields.length > 0 ? (
        <List box label={STATUS_WORDS.field}>
          {fields.map((field, at) => (
            <ListItem
              key={field.id}
              title={field.name}
              description={fieldSummary(field)}
              onClick={() => setEditing({ kind: field.kind, field })}
              control={
                <MoreMenu of={`'${field.name}'`}>
                  {at > 0 && <MenuItem icon={ArrowUp} label={MOVE.up} onClick={() => write(moved(fields, at, at - 1))} />}
                  {at < fields.length - 1 && <MenuItem icon={ArrowDown} label={MOVE.down} onClick={() => write(moved(fields, at, at + 1))} />}
                  <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => write(fields.filter(({ id }) => id !== field.id))} />
                </MoreMenu>
              }
            />
          ))}
        </List>
      ) : (
        <Empty variant="section">{STATUS_WORDS.noFields}</Empty>
      )}
      <Menu label={addOf(STATUS_WORDS.field)} place="below-start" trigger={(opener) => <Button variant="secondary" icon={ACTS.create.icon} {...opener}>{addOf(STATUS_WORDS.field)}</Button>}>
        {STATUS_KINDS.map((kind) => (
          <MenuItem key={kind} label={STATUS_KIND[kind].label} description={STATUS_KIND[kind].description} onClick={() => setEditing({ kind })} />
        ))}
      </Menu>
      {editing && (
        <StatusFieldDialog
          {...editing}
          among={fields}
          row={list.of === 'log'}
          onClose={() => setEditing(null)}
          onSave={(field) => {
            setEditing(null);
            write(editing.field ? fields.map((each) => (each.id === field.id ? field : each)) : [...fields, field]);
          }}
        />
      )}
    </>
  );
}

type Naming = { title: string; value: string; among: readonly { id: string; name: string }[]; self?: string; onSave: (name: string) => void };

// A name asked in a dialog, one of its place's others refused.
function useNaming() {
  const toast = useToast();
  const [naming, setNaming] = useState<Naming | null>(null);
  const dialog = naming && (
    <NameDialog
      title={naming.title}
      value={naming.value}
      onClose={() => setNaming(null)}
      onSave={(name) => {
        if (nameTaken(naming.among, name, naming.self)) return toast.error(statusTaken(name));
        setNaming(null);
        naming.onSave(name);
      }}
    />
  );
  return { ask: setNaming, dialog };
}

// 묶음 or 기록: a titled part each, renamed and removed from its ⋯, with what only its kind has above its fields.
function Parts({ definition, of, onChange, children }: { definition: StatusDefinition; of: 'group' | 'log'; onChange: Change; children?: (id: string) => ReactNode }) {
  const naming = useNaming();
  const [key, word, none, add, remove] = of === 'group' ? (['groups', STATUS_WORDS.group, STATUS_WORDS.noGroups, withGroup, withoutGroup] as const) : (['logs', STATUS_WORDS.log, STATUS_WORDS.noLogs, withLog, withoutLog] as const);
  const parts = definition[key];
  // Both stand under one kind of heading in a writer's block, so neither takes the other's name.
  const among = [...definition.groups, ...definition.logs];
  const rename = (id: string, name: string) => onChange({ ...definition, [key]: parts.map((each) => (each.id === id ? { ...each, name } : each)) });
  return (
    <Section
      title={word}
      action={
        <Button variant="link" onClick={() => naming.ask({ title: addOf(word), value: '', among, onSave: (name) => onChange(add(definition, crypto.randomUUID(), name)) })}>
          {addOf(word)}
        </Button>
      }
    >
      {parts.length === 0 && <Empty variant="section">{none}</Empty>}
      {parts.map(({ id, name }) => (
        <Section
          key={id}
          level={3}
          title={name}
          action={
            <MoreMenu of={`'${name}'`}>
              <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => naming.ask({ title: ACTS.rename.label, value: name, among, self: id, onSave: (next) => rename(id, next) })} />
              <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => onChange(remove(definition, id))} />
            </MoreMenu>
          }
        >
          {children?.(id)}
          <Fields definition={definition} list={{ of, id }} onChange={onChange} />
        </Section>
      ))}
      {naming.dialog}
    </Section>
  );
}

// What only a 묶음 has: whether its writer adds records, and the ones it starts with. A record keeps its id by its name.
function Members({ definition, id, folders, onChange }: { definition: StatusDefinition; id: string; folders?: readonly LoreFolder[]; onChange: Change }) {
  const group = definition.groups.find((each) => each.id === id)!;
  const write = (next: typeof group) => onChange({ ...definition, groups: definition.groups.map((each) => (each.id === id ? next : each)) });
  const named = (names: string[]) =>
    names.reduce<typeof group.members>((members, typed) => {
      const name = typed.trim();
      return !name || nameTaken(members, name) ? members : [...members, group.members.find((each) => each.name === name) ?? { id: crypto.randomUUID(), name }];
    }, []);
  return (
    <SettingGroup label={group.name}>
      <SettingRow label={STATUS_WORDS.open} help={STATUS_WORDS.openNote} control={<Switch label={STATUS_WORDS.open} checked={group.open === true} onChange={(on) => write(on ? { ...group, open: true } : without(group, 'open'))} />} />
      <SettingRow label={STATUS_WORDS.members} wide control={<PhraseField label={STATUS_WORDS.members} phrases={group.members.map(({ name }) => name)} onChange={(names) => write({ ...group, members: named(names) })} />} />
      {folders && (
        <SettingRow
          label={STATUS_WORDS.follow}
          help={STATUS_WORDS.followNote}
          control={
            <ChoiceGroup
              label={STATUS_WORDS.follow}
              layout="menu"
              options={[{ value: '', label: STATUS_WORDS.followNone }, ...folders.map(({ id: folder, name }) => ({ value: folder, label: name }))]}
              value={group.follows?.folder ?? ''}
              empty={STATUS_WORDS.followGone}
              onChange={(folder) => write(folder ? { ...group, follows: { folder } } : without(group, 'follows'))}
            />
          }
        />
      )}
    </SettingGroup>
  );
}

function Views({ definition, onChange }: { definition: StatusDefinition; onChange: Change }) {
  const naming = useNaming();
  const views = definition.views ?? [];
  const change = (id: string, to: (view: StatusView) => StatusView) => onChange({ ...definition, views: views.map((each) => (each.id === id ? to(each) : each)) });
  const write = (id: string, patch: Partial<StatusView>) => change(id, (view) => ({ ...view, ...patch }));
  return (
    <Section
      title={STATUS_WORDS.view}
      action={
        <Button variant="link" onClick={() => naming.ask({ title: addOf(STATUS_WORDS.view), value: '', among: views, onSave: (name) => onChange(withView(definition, crypto.randomUUID(), name)) })}>
          {addOf(STATUS_WORDS.view)}
        </Button>
      }
    >
      {views.length === 0 && <Empty variant="section">{STATUS_WORDS.noViews}</Empty>}
      {views.map((view) => {
        const { id, name, frame, mood, app } = view;
        return (
          <Section
            key={id}
            level={3}
            title={name}
            action={
              <MoreMenu of={`'${name}'`}>
                <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => naming.ask({ title: ACTS.rename.label, value: name, among: views, self: id, onSave: (next) => write(id, { name: next }) })} />
                <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => onChange(withoutView(definition, id))} />
              </MoreMenu>
            }
          >
            <SettingGroup label={name}>
              <SettingRow label={STATUS_WORDS.frame} control={<ChoiceGroup<StatusFrame> label={STATUS_WORDS.frame} layout="fit" options={options(STATUS_FRAME)} value={frame} onChange={(next) => write(id, { frame: next })} />} />
              <SettingRow label={STATUS_WORDS.mood} control={<ChoiceGroup<StatusMood> label={STATUS_WORDS.mood} layout="fit" options={options(STATUS_MOOD)} value={mood} onChange={(next) => write(id, { mood: next })} />} />
              <SettingRow
                label={STATUS_WORDS.app}
                help={STATUS_WORDS.appNote}
                control={<ChoiceGroup<StatusApp | ''> label={STATUS_WORDS.app} layout="fit" options={[{ value: '', label: STATUS_WORDS.appNone }, ...options(STATUS_APP)]} value={app ?? ''} onChange={(next) => change(id, (each) => ({ ...without(each, 'app'), ...(next && { app: next }) }))} />}
              />
            </SettingGroup>
            <StatusBlocks definition={definition} view={view} onChange={(blocks) => write(id, { blocks })} />
          </Section>
        );
      })}
      {naming.dialog}
    </Section>
  );
}

// Each view as a chat would draw it, over values standing in for a chat's (sampleState): a 상태창 each, and the ones
// that are apps on one 휴대폰, the app picked there open.
function Preview({ definition }: { definition: StatusDefinition }) {
  const { display } = useDisplay();
  const [picked, setPicked] = useState<string | null>(null);
  const sample = sampleState(definition);
  const views = statusViews(definition);
  const apps = views.filter(({ app }) => app).map((each) => shownApp(definition, each, sample));
  const open = apps.find(({ id }) => id === picked);
  return (
    <Section title={STATUS_WORDS.preview}>
      {views.filter(({ app }) => !app).map((each) => {
        const view = shownView(definition, each, sample);
        return (
          <Stack key={view.id} gap="related">
            {definition.views && <Text variant="note">{view.name}</Text>}
            <StatusPanel name={view.name} frame={view.frame} mood={view.mood} theme={display.theme} blocks={view.blocks} />
          </Stack>
        );
      })}
      {apps.length > 0 && (
        <Stack gap="related">
          <Text variant="note">{PHONE}</Text>
          <StatusPhone name={PHONE} theme={display.theme} apps={apps} onOpen={setPicked} onHome={open ? () => setPicked(null) : undefined}>
            {open ? <StatusPanel bare name={open.name} frame={open.frame} mood={open.mood} theme={display.theme} blocks={open.blocks} /> : null}
          </StatusPhone>
        </Stack>
      )}
    </Section>
  );
}

// 상태 정의 (design §6.1 part 1): one editor wherever a definition is declared, a card, a module or a prompt.
export function StatusEditor({ definition, onChange, onType, lore }: Props) {
  const [removing, setRemoving] = useState(false);
  if (!definition) return <Start onStart={onChange} />;
  const unnamed = !definition.name.trim();
  return (
    <Stack gap="section">
      <Section
        title={STATUS_WORDS.basics}
        action={
          <MoreMenu of={STATUS}>
            <MenuItem icon={ACTS.remove.icon} label={STATUS_WORDS.remove} tone="warn" onClick={() => setRemoving(true)} />
          </MoreMenu>
        }
      >
        <TextField label={STATUS_WORDS.name} value={definition.name} error={unnamed ? STATUS_PROBLEM.name : undefined} onChange={(name) => onType({ ...definition, name }, name.trim() !== '')} />
        <SettingGroup label={STATUS_WORDS.basics}>
          <SettingRow
            label={STATUS_WORDS.writer}
            help={Object.values(STATUS_WRITER).map(({ label, description }) => `${label}: ${description}`).join(' ')}
            control={<ChoiceGroup label={STATUS_WORDS.writer} layout="fit" options={WRITERS} value={definition.writer} onChange={(writer) => onChange({ ...definition, writer })} />}
          />
        </SettingGroup>
      </Section>
      <Section title={STATUS_WORDS.field}>
        <Fields definition={definition} list={{ of: 'definition' }} onChange={onChange} />
      </Section>
      <Parts definition={definition} of="group" onChange={onChange}>
        {(id) => <Members definition={definition} id={id} folders={lore?.folders} onChange={onChange} />}
      </Parts>
      <Parts definition={definition} of="log" onChange={onChange} />
      <Views definition={definition} onChange={onChange} />
      <Preview definition={lore ? rostered(definition, lore.entries) : definition} />
      {removing && (
        <ConfirmDialog title={STATUS_WORDS.removeAsk} confirm={ACTS.remove.label} icon={ACTS.remove.icon} onConfirm={() => {
            setRemoving(false);
            onChange(undefined);
          }} onClose={() => setRemoving(false)}>
          {STATUS_WORDS.removeNote}
        </ConfirmDialog>
      )}
    </Stack>
  );
}
