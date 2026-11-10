import type { Assembled } from '../../engine/pipeline';
import type { Shown } from '../../runtime/chat/talk';

export const infoReply = (replies: Shown[], picked: string | null) => replies.find((message) => message.id === picked) ?? replies.at(-1);

// What a reply starting while 응답 정보 is held leaves picked: nothing when it is the latest message, so 정보 goes on
// following the latest after it; an earlier one (다시 시도, 이어 쓰기 on an older reply) is picked.
export const pickStarted = (messages: Shown[], started: string) => (started === messages.at(-1)?.id ? null : started);

export const budgetCut = (lore: Assembled['lore']) => lore?.filter(({ fate }) => fate.kind === 'dropped' && fate.cause === 'budget').length ?? 0;
