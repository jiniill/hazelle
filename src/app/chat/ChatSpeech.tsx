import type { SpeechSetup } from '../../runtime/library/characters';
import { FEATURE_ICONS } from '../common/featureIcons';
import { SpeechRows } from '../common/SpeechRows';
import { PerCharacter } from '../common/TaskPrompt';
import { AUTO_SPEECH, FEATURE_NAMES, scopeTag } from '../common/words';
import { Menu, Section, ToolButton } from '../ui';
import type { RowTool } from './ChatToolRow';
import type { SpeechActions } from './useChatSpeech';

type Props = {
  speech: SpeechSetup;
  card: { name: string } | null;
  onChange: SpeechActions['setSpeech'];
  onOwnChange: SpeechActions['setOwnSpeech'];
};

const NAME = FEATURE_NAMES.speech;

export const speechTool = (props: Props): RowTool => ({ key: 'speech', label: NAME, icon: FEATURE_ICONS.speech, live: props.speech.auto, node: <ChatSpeech {...props} />, open: <SpeechForm {...props} /> });

function ChatSpeech(props: Props) {
  const { auto } = props.speech;
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label={NAME}
      trigger={(opener) => <ToolButton icon={FEATURE_ICONS.speech} label={NAME} phone="icon" detail={auto ? `${AUTO_SPEECH} 켜짐` : undefined} mark={auto ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <SpeechForm {...props} />
    </Menu>
  );
}

function SpeechForm({ speech, card, onChange, onOwnChange }: Props) {
  return (
    <Section level={3} title={NAME} tag={scopeTag(card && speech.own ? 'character' : 'default')}>
      <SpeechRows speech={speech} card={card} opens="up" onChange={onChange}>
        <PerCharacter card={card} own={speech.own} onChange={onOwnChange} />
      </SpeechRows>
    </Section>
  );
}
