import { useState } from 'react';
import { shownApp, shownAt } from '../common/statusView';
import { PHONE } from '../common/words';
import { useDisplay } from '../display';
import { SidePanel, StatusPanel, StatusPhone, type ShownPlace } from '../ui';
import { RecordLore } from './ChatStateDetail';
import type { OpenChat } from './useChat';

// What the 휴대폰 stands on: an app (a view, by its definition's id and its own), or one record opened from it.
type Open = { app: string; member?: NonNullable<ShownPlace['member']> };

// 휴대폰 (design §6.1 part 4): the views that are apps, of every definition of the chat, beside the story. The home
// lists them; an app shows its view, a record's name there its record: its fields, and the lorebook entry it stands
// for. Nothing is edited here: 상세 is where a value is.
export function ChatPhone({ chat, onClose }: { chat: Pick<OpenChat, 'states' | 'actions'>; onClose: () => void }) {
  const { display } = useDisplay();
  const [open, setOpen] = useState<Open | null>(null);
  const apps = chat.states.flatMap((state) => state.apps.map((view) => ({ key: `${state.definition.id}:${view.id}`, state, app: shownApp(state.definition, view, state.now, state.before) })));
  // An app that is gone goes back to the home, a record that left to its app.
  const at = open && apps.find(({ key }) => key === open.app);
  const member = at && open.member;
  const record = at && member ? shownAt(at.state.definition, at.state.now, at.state.before, { member }) : [];
  const name = member && record.length ? at.state.now.groups[member.group]?.find(({ id }) => id === member.id)?.name : undefined;
  const look = { theme: display.theme, onChoice: chat.actions.choose };
  return (
    <SidePanel
      title={PHONE}
      nav={at ? { title: name ?? at.app.name, description: at.state.definition.name, backLabel: name === undefined ? PHONE : at.app.name, onBack: () => setOpen(name === undefined ? null : { app: at.key }) } : undefined}
      onClose={onClose}
    >
      <StatusPhone name={PHONE} theme={display.theme} apps={apps.map(({ key, app }) => ({ id: key, name: app.name, icon: app.icon, fresh: app.fresh }))} onOpen={(app) => setOpen({ app })} onHome={at ? () => setOpen(null) : undefined}>
        {!at ? null : member && name !== undefined ? (
          <StatusPanel bare name={name} frame="card" mood={at.app.mood} blocks={record} {...look}>
            <RecordLore id={member.id} />
          </StatusPanel>
        ) : (
          <StatusPanel bare name={at.app.name} frame={at.app.frame} mood={at.app.mood} blocks={at.app.blocks} onMember={(next) => setOpen({ app: at.key, member: next })} {...look} />
        )}
      </StatusPhone>
    </SidePanel>
  );
}
