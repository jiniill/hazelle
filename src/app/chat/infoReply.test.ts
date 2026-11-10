import { describe, expect, it } from 'vitest';
import type { Shown } from '../../runtime/chat/talk';
import { budgetCut, infoReply, pickStarted } from './infoReply';

const message = (id: string, role: 'user' | 'assistant'): Shown => ({ id, role, at: 0, versions: [], selected: 0, live: null });

describe('the reply 응답 정보 shows', () => {
  it('follows the latest unless a reply was picked, and a reply started while held is picked only when it is not the latest', () => {
    const messages = [message('a', 'assistant'), message('u', 'user'), message('b', 'assistant')];
    const replies = messages.filter((each) => each.role === 'assistant');
    expect(infoReply(replies, null)?.id).toBe('b');
    expect(infoReply(replies, 'a')?.id).toBe('a');
    expect(infoReply(replies, 'gone')?.id).toBe('b');
    expect(pickStarted(messages, 'b')).toBeNull();
    expect(pickStarted(messages, 'a')).toBe('a');
  });
});

describe('the entries 로어북 최대 분량 cut from a reply', () => {
  it('counts only the entries the budget dropped, and none for a chat without a lorebook', () => {
    const why = { kind: 'constant' } as const;
    const lore = [
      { id: 'a', name: 'a', why, fate: { kind: 'placed', tokens: 5 } },
      { id: 'b', name: 'b', why, fate: { kind: 'dropped', cause: 'budget', tokens: 9 } },
      { id: 'c', name: 'c', why, fate: { kind: 'dropped', cause: 'probability' } },
      { id: 'd', name: 'd', why, fate: { kind: 'dropped', cause: 'budget', tokens: 4 } },
    ] as const;
    expect(budgetCut([...lore])).toBe(2);
    expect(budgetCut(null)).toBe(0);
  });
});
