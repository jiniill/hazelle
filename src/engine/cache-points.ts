import type { ChatMessage } from '../connectors/types';
import type { From } from './pipeline';

// origin: the id of the chat message it was made from (HistoryMessage.message), which the bot's Lua reads as Risu's
// memo; none for any other text.
export type Sent = { message: ChatMessage; from: From; origin?: string };
export type CachePart = { cache: true };

// Cache before/at chat, never request end: following blocks change each turn. Depth/retrieval entries count as chat.
// Cache before leading memory too so boundary updates do not rewrite the fixed prefix (design §6.2).
export function autoCachePoints(roles: readonly ('chat' | 'depth' | 'memory' | null)[]): number[] {
  const first = roles.findIndex((role) => role === 'chat' || role === 'depth');
  const last = roles.lastIndexOf('chat');
  const memory = roles.indexOf('memory');
  const anchor = memory > 0 && (first === -1 || memory < first) ? [memory - 1] : [];
  return [...new Set([...anchor, ...(first > 0 ? [first - 1] : []), ...(last === -1 ? [] : [last])])];
}

export function cachePoints(parts: (Sent | CachePart)[]): Sent[] {
  const sent: Sent[] = [];
  const point = (index: number) => {
    const part = sent[index]!;
    sent[index] = { ...part, message: { ...part.message, cache: true } };
  };
  for (const part of parts) {
    if (!('cache' in part)) sent.push(part);
    else if (sent.length) point(sent.length - 1);
  }
  // Retrieval sits among the chat's messages and changes with them, so it counts as the chat's: first in a short chat, it
  // must not take the point meant for the memory block's end.
  const role = ({ from }: Sent) => (from.kind === 'depth' ? 'depth' : from.kind === 'retrieval' ? 'chat' : from.kind === 'block' && (from.slot === 'chat' || from.slot === 'memory') ? from.slot : null);
  for (const index of autoCachePoints(sent.map(role))) point(index);
  return sent;
}

