import { useState } from 'react';
import { readOnboarding, type Onboarding } from '../../engine/import/onboarding';
import { ONBOARDING } from '../common/words';
import { SHORTCUTS } from '../shortcuts';
import { Section, TextField } from '../ui';

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// The card's 시작 전 설문 as Risu's JSON, the shape Risu's own editor writes; a blank field is none. Text that reads as
// no survey is kept on screen and not saved, so a half-typed edit never clears it.
export function OnboardingEditor({ onboarding, onChange }: { onboarding: Onboarding | undefined; onChange: (onboarding: Onboarding | undefined) => void }) {
  const [text, setText] = useState(() => (onboarding ? JSON.stringify(onboarding, null, 2) : ''));
  const [unread, setUnread] = useState(false);
  const edit = (next: string) => {
    setText(next);
    const read = next.trim() ? readOnboarding(parsed(next)) : undefined;
    setUnread(next.trim() !== '' && read === undefined);
    if (read || !next.trim()) onChange(read);
  };
  return (
    <Section title={ONBOARDING} help="새 채팅을 시작할 때 질문하고 답을 채팅 변수에 저장해요. RisuAI의 onboarding JSON 형식을 써요.">
      <TextField label={ONBOARDING} showLabel={false} kind="key" lines={8} expand={SHORTCUTS.bigEdit.keys} placeholder="비어 있음" value={text} error={unread ? '올바른 JSON 객체 형식이 아니에요.' : undefined} onChange={edit} />
    </Section>
  );
}
