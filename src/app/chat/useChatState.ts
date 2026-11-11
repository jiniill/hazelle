import { useMemo } from 'react';
import { shown, statusChanges, type Chat, type Message } from '../../model/chat';
import { statusAfter, statusViews, type StatusChange, type StatusDefinition, type StatusOf, type StatusView } from '../../model/status';
import { statusOf } from '../../runtime/chat/chat-context';
import { setStatusByHand } from '../../runtime/chat/chat-log';
import type { StatusFailure, StatusWriting } from '../../runtime/tasks/status';
import { describeStatusFailure } from '../common/failure';
import { useCaptured, useSession, useStatusWriting } from '../session';
import { useToast } from '../toast';
import { useToldFailures } from './useToldFailures';

// What the latest reply did to a definition's state: written, being written, or left as it was (why, when a call
// failed). null where there is nothing to say: no reply yet, or the latest message is the user's.
export type StateMark = { kind: 'writing' } | { kind: 'missed'; failure: StatusFailure | null } | null;

// One definition as the chat shows it: its state now, and as it stood before the latest reply (the same while there
// is no latest reply, so nothing reads as just moved).
export type ChatStateOf = { definition: StatusDefinition; views: StatusView[]; now: StatusOf; before: StatusOf; mark: StateMark };

// Told once per version: a failed write stays marked on the panel.
const told = new Set<string>();

// A greeting is a reply no model wrote: it has no state of its own to miss.
const replyOf = (last: Message | undefined) => (last?.role === 'assistant' && shown(last).receipt ? last : undefined);

// Each definition over the versions shown. busy: a reply is under way, so nothing is marked yet.
export function chatStates(definitions: readonly StatusDefinition[], messages: readonly Message[], writing: StatusWriting, busy: boolean): ChatStateOf[] {
  if (!definitions.length) return [];
  const last = messages.at(-1);
  const reply = replyOf(last);
  const now = statusAfter(definitions, statusChanges(messages));
  const before = reply ? statusAfter(definitions, statusChanges(messages.slice(0, -1))) : now;
  const job = last && writing.get(shown(last).id);
  return definitions.map((definition) => {
    const write = reply && (shown(reply).status ?? []).findLast(({ of }) => of.includes(definition.id));
    const mark: StateMark = !reply || busy ? null : job && !job.failure ? { kind: 'writing' } : !write || write.missed ? { kind: 'missed', failure: job?.failure ?? null } : null;
    return { definition, views: statusViews(definition), now: now[definition.id]!, before: before[definition.id]!, mark };
  });
}

// 상태 (design §6.1) for the open chat: every definition its prompt and packs declare, over the versions shown.
// id null is a chat not saved yet, which has its starting state and nothing to write to.
export function useChatState(chatId: string, id: string | null, chat: Chat, messages: readonly Message[], busy: boolean) {
  const { store, statusWriter } = useSession();
  const toast = useToast();
  const writing = useStatusWriting();
  const definitions = useCaptured((captured) => statusOf(captured, chat), [chat]);
  const last = messages.at(-1);
  const reply = replyOf(last);

  useToldFailures(writing, chatId, { told, failures: (entry) => [entry.failure], key: (_: StatusFailure, entry) => `${entry.chat}:${entry.message}`, describe: describeStatusFailure });

  const states = useMemo(() => chatStates(definitions, messages, writing, busy), [definitions, messages, writing, busy]);

  return {
    states,
    actions: {
      // 상태 다시 쓰기: the latest reply's state asked again, its text left as it is.
      rewriteState: () => {
        if (id && reply) statusWriter.write(id, reply.id, shown(reply).id, true);
      },
      // A value edited by hand is a change of the latest message's shown version, over its writer's.
      editState: (change: StatusChange) => {
        if (id && last) void toast.settled(setStatusByHand(store, id, shown(last).id, change));
      },
    },
  };
}
