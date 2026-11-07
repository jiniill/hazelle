import type { ChatSummary } from '../../model/chat';

// A chat's family: the chats copied or branched from one another, down from the eldest. A ghost is an origin no longer
// listed (deleted), kept so the family stays connected, under the name a child kept of it.
export type Member = { kind: 'chat'; chat: ChatSummary; children: Child[] } | { kind: 'ghost'; id: string; name: string; children: Child[] };
// at: the origin's message the split comes after, counted from 1 (origin.shared), or null where the map must not guess:
// a copy, a branch made before shared was kept, or an origin whose messages are not counted (a ghost, an unsaved summary).
export type Child = { kind: 'branch' | 'copy'; at: number | null; member: Member };

export function family(chats: readonly ChatSummary[], current: string): Member {
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  let top = byId.get(current)!;
  for (let origin = top.chat.origin; origin && byId.has(origin.id); origin = top.chat.origin) top = byId.get(origin.id)!;
  const childrenOf = (id: string, count: number | null): Child[] => chats.filter(({ chat }) => chat.origin?.id === id).map((child) => {
    const { after, shared } = child.chat.origin!;
    return { kind: after === null ? 'copy' : 'branch', at: after !== null && shared !== undefined && count ? shared : null, member: member(child) };
  });
  const member = (chat: ChatSummary): Member => ({ kind: 'chat', chat, children: childrenOf(chat.id, chat.count) });
  const { origin } = top.chat;
  return origin ? { kind: 'ghost', id: origin.id, name: origin.name, children: childrenOf(origin.id, null) } : member(top);
}
