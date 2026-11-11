import { Layers, ListRestart } from 'lucide-react';
import { useState } from 'react';
import { statusAt, type StatusChange } from '../../model/status';
import { describeStatusFailure } from '../common/failure';
import { shownMain, shownView } from '../common/statusView';
import { STATUS_FOLD, STATUS_MISSED, STATUS_NEXT_VIEW, STATUS_REWRITE, STATUS_WRITING, statusEdit } from '../common/words';
import { useDisplay } from '../display';
import { IconButton, Stack, StatusPanel, type ShownPlace, type Theme } from '../ui';
import { StateEdit } from './StateEdit';
import type { ChatStateOf, StateMark } from './useChatState';

type Props = {
  states: ChatStateOf[];
  // Absent where the latest reply's state cannot be asked again: a chat not saved yet, or a reply under way.
  onRewrite?: () => void;
  // Absent where there is no version to hold a change by hand: a chat not saved yet, or a reply under way.
  onEdit?: (change: StatusChange) => void;
  onChoice: (text: string) => void;
};

const noteOf = (mark: StateMark) => (mark?.kind === 'writing' ? { text: STATUS_WRITING } : mark ? { text: mark.failure ? `${STATUS_MISSED} · ${describeStatusFailure(mark.failure)}` : STATUS_MISSED, warn: true } : undefined);

type Shown = { theme: Theme; folded: boolean; onFold: (folded: boolean) => void };

function StatePanel({ state, theme, folded, onFold, onRewrite, onEdit, onChoice }: { state: ChatStateOf } & Shown & Omit<Props, 'states'>) {
  const { definition, views, now, before, mark } = state;
  const [picked, setPicked] = useState(0);
  const [editing, setEditing] = useState<ShownPlace | null>(null);
  // Nothing once the field or its record is gone while its editor stood open.
  const edited = editing && statusAt(definition, now, editing);
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
            </>
          ),
        }}
      />
      {onEdit && editing && edited && (
        <StateEdit
          field={edited.field}
          value={edited.values[edited.field.id]}
          of={edited.member?.name}
          onClose={() => setEditing(null)}
          onSave={(value) => {
            onEdit({ definition: definition.id, kind: 'set', ...editing, value });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

// 상태창 (design §6.1): the chat's state, a panel a definition, each in the view picked for it. Folding is the
// reader's on this device, one switch for every panel.
export function ChatState({ states, ...rest }: Props) {
  const { display, changeDisplay } = useDisplay();
  const shown: Shown = { theme: display.theme, folded: display.statusFolded, onFold: (statusFolded) => changeDisplay({ statusFolded }) };
  return (
    <Stack gap="group">
      {states.map((state) => (
        <StatePanel key={state.definition.id} state={state} {...shown} {...rest} />
      ))}
    </Stack>
  );
}
