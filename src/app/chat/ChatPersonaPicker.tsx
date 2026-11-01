import { UserRound } from 'lucide-react';
import { aliased } from '../common/alias';
import { PersonaPickDialog } from '../common/PersonaPickDialog';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { Avatar, Button, Checkbox, ChipButton, Hint, Row } from '../ui';
import type { PersonaChoice } from '../../runtime/personas';
import type { RowTool } from './ChatToolRow';
import type { ChatSettingsActions } from './useChatSettings';

const MISSING = { chat: '페르소나 삭제됨', character: '고정한 페르소나 삭제됨', current: '현재 페르소나 삭제됨' };

type PickerProps = { persona: PersonaChoice; open: boolean; onOpen: () => void };

export const personaTool = (props: PickerProps): RowTool => ({ key: 'persona', label: '페르소나', icon: UserRound, live: props.persona.kind !== 'persona', node: <ChatPersonaPicker {...props} />, open: props.onOpen });

function ChatPersonaPicker({ persona, open, onOpen }: PickerProps) {
  const shown = persona.kind === 'persona' ? persona.persona.value : null;
  return (
    <ChipButton
      label={shown ? aliased(shown.name, shown.alias) : MISSING[persona.from]}
      title="이 채팅의 페르소나"
      variant="ghost"
      opens="up"
      popup="dialog"
      expanded={open}
      ref={null}
      leading={<Avatar size="sm" tone="you" face={shown?.name ?? UserRound} image={shown?.picture} />}
      tone={shown ? 'plain' : 'warn'}
      onClick={onOpen}
    />
  );
}

type DialogProps = {
  persona: PersonaChoice;
  characterName: string | null;
  pinned: string | undefined;
  onChoose: ChatSettingsActions['choosePersona'];
  onPin: ChatSettingsActions['pinPersona'];
  onClose: () => void;
};

export function PersonaDialog({ persona, characterName, pinned, onChoose, onPin, onClose }: DialogProps) {
  const toast = useToast();
  const using = persona.kind === 'persona' ? persona.persona.id : null;

  function choose(id: string) {
    onClose();
    void onChoose(id).then((saved) => saved.ok || toast.failed(saved));
  }

  const footer = (
    <>
      {characterName !== null && (
        <Row kind="toolbar">
          <Checkbox
            label={`${characterName}에 고정`}
            checked={using !== null && pinned === using}
            disabled={using === null}
            onChange={(checked) => void onPin(checked ? using : null).then((saved) => saved.ok || toast.failed(saved))}
          />
          <Hint label="고정">이 캐릭터와 새로 시작하는 채팅에 이 페르소나를 써요.</Hint>
        </Row>
      )}
      <Button variant="link" onClick={() => navigate(using ? { kind: 'persona', id: using } : { kind: 'personas', place: null })}>
        페르소나 관리
      </Button>
    </>
  );
  return <PersonaPickDialog title="이 채팅의 페르소나" using={using} pinned={pinned} onChoose={choose} onClose={onClose} footer={footer} />;
}
