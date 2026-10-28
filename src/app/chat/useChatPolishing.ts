import { useEffect, useMemo } from 'react';
import type { Polishing, PolishStep } from '../../runtime/agents';
import { describeAgentFailure } from '../common/failure';
import { withParticle } from '../common/particles';
import { usePolishing } from '../session';
import { useToast } from '../toast';

// Each failure is said once on this page: the reply stays as written, which the toast says.
const told = new WeakSet<NonNullable<ReturnType<Polishing['get']>>>();

// By the messages of the chat whose reply its post agents are working on now, the agent at work.
export function useChatPolishing(chatId: string): ReadonlyMap<string, PolishStep> {
  const toast = useToast();
  const polishing = usePolishing();

  useEffect(() => {
    for (const entry of polishing.values()) {
      if (entry.chat !== chatId || !entry.failure || told.has(entry)) continue;
      told.add(entry);
      toast.error(`${withParticle(entry.failure.name, '이/가')} 실패해서 응답을 끝까지 다듬지 못했어요. ${describeAgentFailure(entry.failure)}`);
    }
  }, [polishing]);

  return useMemo(() => new Map([...polishing.values()].flatMap(({ chat, message, step }): [string, PolishStep][] => (chat === chatId && step ? [[message, step]] : []))), [polishing, chatId]);
}
