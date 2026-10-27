import { useEffect } from 'react';
import { scriptVoice } from '../common/script-voice';
import { useScripts, useSession } from '../session';
import { AskCard } from '../ui';
import { asking } from './ask';

// Keep script questions oldest-first by the composer, never modal, so the chat remains usable (design §6.8).
// onTyped marks an answer that held input focus.
export function ChatAsk({ id, onTyped }: { id: string | null; onTyped: () => void }) {
  const { scriptInteractions, store } = useSession();
  const asked = useScripts().questions.find((question) => question.chat === id);
  const from = asked && scriptVoice(store, asked.from);
  const orphan = asked && !from ? asked.id : null;
  // Its asker was deleted while it asked. Dismissed, not just hidden: a hidden one would hold back the questions after it.
  useEffect(() => {
    if (orphan !== null) scriptInteractions.answer(orphan, null);
  }, [orphan]);
  if (!asked || !from) return null;
  return (
    <AskCard
      key={asked.id}
      from={from}
      {...asking(asked.question, from.asker)}
      onAnswer={(answer) => {
        scriptInteractions.answer(asked.id, answer);
        if (asked.question.kind === 'input') onTyped();
      }}
    />
  );
}
