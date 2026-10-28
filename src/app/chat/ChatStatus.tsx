import { PinOff } from 'lucide-react';
import { IconButton, SidePeek, Stack, StatusBox } from '../ui';
import { useAssetUrl } from '../session';
import { shownHtml } from './ChatMessage';
import type { OpenChat } from './useChat';

type Props = Pick<OpenChat, 'status' | 'held' | 'decor'> & {
  onHold: (held: boolean) => void;
  onPress: OpenChat['actions']['press'];
  onUnmark: (script: OpenChat['status'][number]) => void;
};

export function ChatStatusPeek({ status, held, decor, onHold, onPress, onUnmark }: Props) {
  const url = useAssetUrl([status, decor.bot]);
  return (
    <SidePeek
      label="상태"
      open={held}
      onOpenChange={onHold}
      actions={unmarkOnly(status, onUnmark)}
    >
      <Stack gap="section">
        {status.map((box) => (
          <StatusBox
            key={box.id}
            name={box.name}
            html={box.drawn && shownHtml(box.drawn.html, { bot: decor.bot, url })}
            css={decor.css}
            buttons={decor.buttons}
            onPress={onPress}
            actions={status.length > 1 && unmark(box, onUnmark)}
          />
        ))}
      </Stack>
    </SidePeek>
  );
}

const unmark = (script: Props['status'][number], onUnmark: Props['onUnmark']) => (
  <IconButton icon={PinOff} size="sm" label={`상태창 지정 풀기 · ${script.name}`} onClick={() => onUnmark(script)} />
);

// One box has no head of its own: its 지정 풀기 sits with the drawer's actions.
const unmarkOnly = (status: Props['status'], onUnmark: Props['onUnmark']) => status.length === 1 && unmark(status[0]!, onUnmark);
