import { PenLine } from 'lucide-react';
import { CountedField } from '../common/CountedFields';
import { follows, ONLY_THIS_CHAT, IN_USE, DEFAULT_NOTE, EMPTY_VALUE } from '../common/words';
import { Button, Menu, Row, Stack, Text, ToolButton, useMenuClose } from '../ui';
import type { PromptChoice } from '../../runtime/library/prompts';
import type { RowTool } from './ChatToolRow';
import type { ChatSettingsActions } from './useChatSettings';
import { useChatNote } from './useChatNote';
import { SLOT } from '../common/prompt-words';

type Props = { id: string | null; note: string | undefined; prompt: PromptChoice; onSave: ChatSettingsActions['setNote'] };

export const noteTool = (props: Props): RowTool => ({ key: 'note', label: '노트', icon: PenLine, live: props.note !== undefined, node: <ChatNote {...props} />, open: <NoteEditor {...props} /> });

// Empty string explicitly suppresses the note; null follows the prompt. Keep runtime/chat/chat-context and lua/snapshot aligned.
function ChatNote(props: Props) {
  const { note } = props;
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label={SLOT.authorNote.name}
      trigger={(opener) => (
        <ToolButton
          icon={PenLine}
          label="노트"
          phone="icon"
          detail={note === undefined ? undefined : note ? '이 채팅 전용 노트' : '노트 없음'}
          mark={note === undefined ? undefined : { kind: 'dot' }}
          {...opener}
        />
      )}
    >
      <NoteEditor {...props} />
    </Menu>
  );
}

function NoteEditor({ id, note, prompt, onSave }: Props) {
  const close = useMenuClose();
  const fallback = prompt.kind === 'prompt' ? prompt.prompt.value.authorNote : null;
  const { text, own, status, change, follow } = useChatNote('note', id, note, onSave, '', fallback ?? '');
  const state = own
    ? text
      ? '이 채팅 전용 노트'
      : '노트 없음'
    : fallback === null
      ? `프롬프트가 없어 ${DEFAULT_NOTE}를 확인할 수 없음`
      : fallback
        ? `${DEFAULT_NOTE} ${IN_USE}`
        : `프롬프트의 ${DEFAULT_NOTE}: ${EMPTY_VALUE}`;

  return (
    <Stack gap="related">
      <CountedField
        label={SLOT.authorNote.name}
        lines={5}
        value={text}
        onChange={change}
        placeholder="예: 이번 장면은 짧게 끝내요."
        help={ONLY_THIS_CHAT}
        action={
          <Text variant="note">
            {status}
          </Text>
        }
      />
      <Row kind="spread">
        <Text variant="note">
          {state}
        </Text>
        {text && (
          <Button variant="ghost" size="sm" onClick={() => change('')}>
            비우기
          </Button>
        )}
        {own && (
          <Button variant="ghost" size="sm" onClick={follow}>
            {follows(DEFAULT_NOTE)}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={close}>
          닫기
        </Button>
      </Row>
    </Stack>
  );
}
