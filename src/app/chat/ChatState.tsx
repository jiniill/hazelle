import { Layers, ListRestart, PanelRight, Pin } from 'lucide-react';
import { useState } from 'react';
import { describeStatusFailure } from '../common/failure';
import { shownMain, shownView } from '../common/statusView';
import { STATUS_DETAIL, STATUS_FOLD, STATUS_MISSED, STATUS_NEXT_VIEW, STATUS_PIN, STATUS_REWRITE, STATUS_WRITING, statusEdit } from '../common/words';
import { useDisplay } from '../display';
import { IconButton, Stack, StatusPanel, type ShownPlace, type Theme } from '../ui';
import { StateEditAt } from './StateEdit';
import type { OpenChat } from './useChat';
import type { ChatStateOf, StateMark } from './useChatState';

type Actions = OpenChat['actions'];
type Acts = {
  // Both absent where no version holds them: a chat not saved yet, or a reply under way.
  onRewrite?: Actions['rewriteState'];
  onEdit?: Actions['editState'];
  onChoice: Actions['choose'];
  onDetail: Actions['stateDetail'];
};

const noteOf = (mark: StateMark) => (mark?.kind === 'writing' ? { text: STATUS_WRITING } : mark ? { text: mark.failure ? `${STATUS_MISSED} · ${describeStatusFailure(mark.failure)}` : STATUS_MISSED, warn: true } : undefined);

type Shown = { theme: Theme; folded: boolean; onFold: (folded: boolean) => void; pinned: boolean; onPin: (pinned: boolean) => void };

function StatePanel({ state, theme, folded, onFold, pinned, onPin, onRewrite, onEdit, onChoice, onDetail }: { state: ChatStateOf } & Shown & Acts) {
  const { definition, views, now, before, mark } = state;
  const [picked, setPicked] = useState(0);
  const [editing, setEditing] = useState<ShownPlace | null>(null);
  const at = picked % views.length;
  const view = shownView(definition, views[at]!, now, before);
  return (
    <>
      <StatusPanel
        name={definition.name}
        frame={view.frame}
        mood={view.mood}
        theme={theme}
        blocks={view.blocks}
        onChoice={onChoice}
        edit={onEdit && { label: statusEdit, onEdit: setEditing }}
        head={{
          title: views.length > 1 ? `${definition.name} · ${view.name}` : definition.name,
          note: noteOf(mark),
          open: !folded,
          onOpen: (open) => onFold(!open),
          labels: STATUS_FOLD,
          summary: shownMain(definition, now, before),
          actions: (
            <>
              {views.length > 1 && <IconButton icon={Layers} size="sm" label={STATUS_NEXT_VIEW} onClick={() => setPicked(at + 1)} />}
              {onRewrite && <IconButton icon={ListRestart} size="sm" label={STATUS_REWRITE} disabled={mark?.kind === 'writing'} onClick={onRewrite} />}
              <IconButton icon={PanelRight} size="sm" label={STATUS_DETAIL} onClick={onDetail} />
              <IconButton icon={Pin} size="sm" label={STATUS_PIN} pressed={pinned} onClick={() => onPin(!pinned)} />
            </>
          ),
        }}
      />
      {onEdit && editing && <StateEditAt state={state} place={editing} onEdit={onEdit} onClose={() => setEditing(null)} />}
    </>
  );
}

// 상태창 (design §6.1): the chat's state, a panel a definition, each in the view picked for it. It has two places,
// pinned at the story's top or after the latest reply, and draws only in the one the reader picked: pinned says which
// place this one stands in. Folding and the place are the reader's on this device, one switch each for every panel.
export function ChatState({ chat, pinned }: { chat: Pick<OpenChat, 'states' | 'id' | 'busy' | 'actions'>; pinned: boolean }) {
  const { display, changeDisplay } = useDisplay();
  if (display.statusPinned !== pinned) return null;
  const { actions } = chat;
  const live = chat.id !== null && !chat.busy;
  const shown: Shown = { theme: display.theme, folded: display.statusFolded, onFold: (statusFolded) => changeDisplay({ statusFolded }), pinned, onPin: (statusPinned) => changeDisplay({ statusPinned }) };
  return (
    <Stack gap="group">
      {chat.states.map((state) => (
        <StatePanel key={state.definition.id} state={state} {...shown} onRewrite={live ? actions.rewriteState : undefined} onEdit={live ? actions.editState : undefined} onChoice={actions.choose} onDetail={actions.stateDetail} />
      ))}
    </Stack>
  );
}
