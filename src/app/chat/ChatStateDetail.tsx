import { useState } from 'react';
import { statusSteps } from '../../model/chat';
import { nameTaken } from '../../engine/status';
import { statusCourse } from '../../model/status';
import { ACTS, addOf } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { shownAt, shownCourse, shownWhole } from '../common/statusView';
import { day } from '../common/time';
import { LOREBOOK, STATUS_COURSE, STATUS_DETAIL, STATUS_NONE, STATUS_START, STATUS_LEAVE_NOTE, statusEdit, statusLeave, statusOpen, statusTaken } from '../common/words';
import { useDisplay } from '../display';
import { useStored } from '../session';
import { useToast } from '../toast';
import { Button, ConfirmDialog, Empty, List, ListItem, MarkupText, MenuItem, Row, Section, SidePanel, Stack, StatusPanel, useWide, type ShownPlace } from '../ui';
import { StateEditAt } from './StateEdit';
import type { OpenChat } from './useChat';
import type { ChatStateOf } from './useChatState';

// What 상세 stands on: the whole state, one record, or one field (a record's own when member is there too).
type Page = { definition: string } & Partial<ShownPlace>;

type Props = { chat: Pick<OpenChat, 'states' | 'messages' | 'id' | 'busy' | 'actions'>; onClose: () => void };

// A field's course (design §6.1 상세): each value it took, newest first, a step pressed showing the message it was
// written at.
function Course({ state, place, messages, onShow }: { state: ChatStateOf; place: ShownPlace; messages: Props['chat']['messages']; onShow: (key: string) => void }) {
  const steps = shownCourse(state.definition, statusCourse([state.definition], statusSteps(messages), { definition: state.definition.id, ...place }), place);
  const where = (key: string | null) => {
    const at = messages.findIndex(({ id }) => id === key);
    return at === -1 ? STATUS_START : `#${at + 1} · ${day(messages[at]!.at)}`;
  };
  return (
    <Section title={STATUS_COURSE}>
      <List label={STATUS_COURSE}>
        {steps
          .map(({ key, value, delta }) => <ListItem key={key ?? ''} title={delta ? `${value} (${delta.text})` : value || '—'} description={where(key)} onClick={key === null ? undefined : () => onShow(key)} />)
          .reverse()}
      </List>
    </Section>
  );
}

// A record added by hand to a 묶음 that takes new ones. A name the 묶음 already has is refused: its writer finds a
// record by its name.
function Join({ states, definition, group, onJoin, onClose }: { states: ChatStateOf[]; definition: string; group: string; onJoin: Props['chat']['actions']['editState']; onClose: () => void }) {
  const toast = useToast();
  const state = states.find((each) => each.definition.id === definition);
  const declared = state?.definition.groups.find(({ id }) => id === group);
  if (!state || !declared) return null;
  const taken = (name: string) => nameTaken(state.now.groups[group] ?? [], name);
  return (
    <NameDialog
      title={addOf(declared.name)}
      value=""
      onClose={onClose}
      onSave={(name) => {
        if (taken(name)) return toast.error(statusTaken(name));
        onJoin({ definition, kind: 'join', group, member: { id: crypto.randomUUID(), name } });
        onClose();
      }}
    />
  );
}

// The lorebook entry a record stands for: one that came from a folder its 묶음 follows is under the entry's id.
function RecordLore({ id }: { id: string }) {
  const entry = useStored('lore', id);
  return (
    entry && (
      <Section title={LOREBOOK} level={3}>
        <MarkupText text={entry.value.content} />
      </Section>
    )
  );
}

// 상세 (design §6.1): the chat's whole state beside the story, whatever its views show. A record's name opens the
// record, a value its field: the field's page holds its course, and there the value is edited by hand.
export function ChatStateDetail({ chat, onClose }: Props) {
  const { display } = useDisplay();
  const wide = useWide();
  const [page, setPage] = useState<Page | null>(null);
  const [editing, setEditing] = useState(false);
  // By hand, a 묶음 that takes new records gets one and loses one, as its writer adds and removes them.
  const [joining, setJoining] = useState<{ definition: string; group: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const { states, messages, actions } = chat;
  const live = chat.id !== null && !chat.busy;
  const state = page && states.find(({ definition }) => definition.id === page.definition);
  const blocks = state && page ? shownAt(state.definition, state.now, state.before, page) : [];
  const look = { frame: 'card', mood: 'hazelle', theme: display.theme } as const;

  // A narrow panel covers the story, so it steps aside for the message it points at.
  function show(key: string) {
    actions.seek(key);
    if (!wide) onClose();
  }

  // The record or the field is gone (a record left, a definition changed): back to the whole.
  if (!state || !page || !blocks.length) {
    return (
      <SidePanel title={STATUS_DETAIL} onClose={onClose}>
        {states.length ? (
          <Stack gap="section">
            {states.map(({ definition, now, before }) => (
              <Section key={definition.id} title={definition.name}>
                <StatusPanel
                  name={definition.name}
                  {...look}
                  blocks={shownWhole(definition, now, before)}
                  edit={{ label: statusOpen, onEdit: (place) => setPage({ definition: definition.id, ...place }) }}
                  onMember={(member) => setPage({ definition: definition.id, member })}
                />
                {live && definition.groups.some(({ open }) => open) && (
                  <Row kind="actions">
                    {definition.groups
                      .filter(({ open }) => open)
                      .map((group) => (
                        <Button key={group.id} variant="secondary" icon={ACTS.create.icon} onClick={() => setJoining({ definition: definition.id, group: group.id })}>
                          {addOf(group.name)}
                        </Button>
                      ))}
                  </Row>
                )}
              </Section>
            ))}
          </Stack>
        ) : (
          <Empty>{STATUS_NONE}</Empty>
        )}
        {joining && <Join states={states} {...joining} onJoin={actions.editState} onClose={() => setJoining(null)} />}
      </SidePanel>
    );
  }

  const { definition } = state;
  const { field, member } = page;
  const record = member && state.now.groups[member.group]?.find(({ id }) => id === member.id);
  const named = field === undefined ? undefined : (member ? definition.groups.find(({ id }) => id === member.group)?.fields : definition.fields)?.find(({ id }) => id === field);
  const leaves = live && field === undefined && member && record && definition.groups.find(({ id }) => id === member.group)?.open;
  const back = field !== undefined && member ? { backLabel: record?.name ?? STATUS_DETAIL, onBack: () => setPage({ definition: definition.id, member }) } : { backLabel: STATUS_DETAIL, onBack: () => setPage(null) };
  return (
    <SidePanel
      title={STATUS_DETAIL}
      nav={{ title: named?.name ?? record?.name ?? definition.name, description: named && record ? record.name : definition.name, ...back, ...(leaves && { menu: { of: record.name, items: <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} onClick={() => setLeaving(true)} /> } }) }}
      onClose={onClose}
    >
      <Stack gap="section">
        <StatusPanel
          name={definition.name}
          {...look}
          blocks={blocks}
          edit={field === undefined ? { label: statusOpen, onEdit: (place) => setPage({ definition: definition.id, ...place }) } : live ? { label: statusEdit, onEdit: () => setEditing(true) } : undefined}
        />
        {field !== undefined && <Course state={state} place={{ field, ...(member && { member }) }} messages={messages} onShow={show} />}
        {field === undefined && member && <RecordLore id={member.id} />}
      </Stack>
      {leaving && leaves && (
        <ConfirmDialog
          title={statusLeave(record.name)}
          confirm={ACTS.remove.label}
          icon={ACTS.remove.icon}
          onClose={() => setLeaving(false)}
          onConfirm={() => {
            actions.editState({ definition: definition.id, kind: 'leave', group: member.group, member: member.id });
            setLeaving(false);
            setPage(null);
          }}
        >
          {STATUS_LEAVE_NOTE}
        </ConfirmDialog>
      )}
      {editing && field !== undefined && live && <StateEditAt state={state} place={{ field, ...(member && { member }) }} onEdit={actions.editState} onClose={() => setEditing(false)} />}
    </SidePanel>
  );
}
