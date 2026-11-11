import { Layers, ListRestart, PanelRight, Pin, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { describeStatusFailure } from '../common/failure';
import { shownApp, shownMain, shownView } from '../common/statusView';
import { PHONE, phoneFresh, STATUS_DETAIL, STATUS_FOLD, STATUS_MISSED, STATUS_NEXT_VIEW, STATUS_PIN, STATUS_REWRITE, STATUS_WRITING, statusEdit } from '../common/words';
import { useWorn } from '../display';
import { Button, IconButton, Row, Stack, StatusPanel, type ShownPlace, type Theme } from '../ui';
import { StateEditAt } from './StateEdit';
import type { OpenChat } from './useChat';
import type { StateShown } from '../../model/status';
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

function StatePanel({ state, theme, shown, onShow, onRewrite, onEdit, onChoice, onDetail }: { state: ChatStateOf; theme: Theme; shown: StateShown; onShow: Actions['showState'] } & Acts) {
  const { definition, views, now, before, mark } = state;
  const [editing, setEditing] = useState<ShownPlace | null>(null);
  // A picked view that is gone shows the first, as one never picked does.
  const at = Math.max(0, views.findIndex(({ id }) => id === shown.views?.[definition.id]));
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
          open: !shown.folded,
          onOpen: (open) => onShow({ folded: !open }),
          labels: STATUS_FOLD,
          summary: shownMain(definition, now, before),
          actions: (
            <>
              {views.length > 1 && <IconButton icon={Layers} size="sm" label={STATUS_NEXT_VIEW} onClick={() => onShow({ view: { definition: definition.id, view: views[(at + 1) % views.length]!.id } })} />}
              {onRewrite && <IconButton icon={ListRestart} size="sm" label={STATUS_REWRITE} disabled={mark?.kind === 'writing'} onClick={onRewrite} />}
              <IconButton icon={PanelRight} size="sm" label={STATUS_DETAIL} onClick={onDetail} />
              <IconButton icon={Pin} size="sm" label={STATUS_PIN} pressed={shown.pinned === true} onClick={() => onShow({ pinned: !shown.pinned })} />
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
// place this one stands in. Folding, the place and the view are the reader's for the chat's character (StateShown), one
// fold and one place for every panel. A definition whose views are all apps has no panel; where the chat has apps,
// the 휴대폰 is opened from under the panels, which says how much the latest reply added to it.
export function ChatState({ chat, pinned }: { chat: Pick<OpenChat, 'states' | 'stateShown' | 'id' | 'busy' | 'actions' | 'shelf'>; pinned: boolean }) {
  const { theme } = useWorn(chat.shelf?.character.look);
  if ((chat.stateShown.pinned === true) !== pinned) return null;
  const { actions } = chat;
  const live = chat.id !== null && !chat.busy;
  const apps = chat.states.flatMap(({ definition, apps, now, before }) => apps.map((view) => shownApp(definition, view, now, before)));
  const fresh = apps.reduce((sum, app) => sum + app.fresh, 0);
  return (
    <Stack gap="group">
      {chat.states.filter(({ views }) => views.length > 0).map((state) => (
        <StatePanel key={state.definition.id} state={state} theme={theme} shown={chat.stateShown} onShow={actions.showState} onRewrite={live ? actions.rewriteState : undefined} onEdit={live ? actions.editState : undefined} onChoice={actions.choose} onDetail={actions.stateDetail} />
      ))}
      {apps.length > 0 && (
        <Row kind="actions">
          <Button variant="secondary" size="sm" icon={Smartphone} onClick={actions.phone}>
            {fresh ? `${PHONE} · ${phoneFresh(fresh)}` : PHONE}
          </Button>
        </Row>
      )}
    </Stack>
  );
}
