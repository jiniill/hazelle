import { describe, expect, it } from 'vitest';
import type { Assembled, From } from './pipeline';
import { coverage, placeBrief, prereadPlan, savedCost } from './preread';

const chat: From = { kind: 'block', id: 'c', name: null, slot: 'chat' };
type Row = [From, Assembled['messages'][number], string?];
const sent = (rows: Row[]): Assembled => ({
  messages: rows.map(([, message]) => message),
  parts: rows.map(([from, , origin], at) => ({ from, tokens: at + 1, ...(origin && { origin }) })),
  lore: null,
  silent: null,
  invalidKeys: [],
  loreBudget: 0,
  memory: null, memoryShape: null,
  dropped: 0,
  problems: { found: [], omitted: 0 },
  unseen: 0,
});

const MAIN: Row = [{ kind: 'block', id: 'main', name: null, slot: null }, { role: 'system', content: 'Rules' }];
const CASTLE: Row = [{ kind: 'lore', id: 'l', name: '성', slot: 'lorebook' }, { role: 'system', content: 'The castle' }];
const said = (id: string, role: 'user' | 'assistant', content: string): Row => [chat, { role, content }, id];

const PROMPT = sent([
  MAIN,
  CASTLE,
  [{ kind: 'block', id: 'm', name: null, slot: 'memory' }, { role: 'system', content: 'Records' }],
  said('a', 'user', 'first'),
  said('b', 'assistant', 'second'),
  [{ kind: 'depth', id: 'd', name: '비밀', depth: 1 }, { role: 'system', content: 'A secret' }],
  [chat, { role: 'user', content: 'with a picture', inlays: ['row-p'] }, 'p'],
  said('c', 'assistant', 'third'),
  said('e', 'user', 'latest'),
  [{ kind: 'answer' }, { role: 'user', content: 'Answer' }],
]);
const ALL = { parts: { chat: true, system: true, lore: true }, recent: 0 };

describe('토큰 절약', () => {
  it('takes chat, lorebook (depth inserts too) and the rest as system, keeping the latest chat messages, the latest user message, pictures and the app instruction', () => {
    const plan = prereadPlan(PROMPT, { parts: { chat: true, system: false, lore: true }, recent: 1 })!;
    expect(plan.taken).toEqual([1, 3, 4, 5, 7]);
    expect(plan.material).toBe('[lorebook]\nThe castle\n\n[chat · user]\nfirst\n\n[chat · assistant]\nsecond\n\n[lorebook]\nA secret\n\n[chat · assistant]\nthird');
    expect(plan.tokens).toBe(2 + 4 + 5 + 6 + 8);
    expect(prereadPlan(PROMPT, { parts: { chat: false, system: true, lore: false }, recent: 0 })?.taken).toEqual([0, 2]);
    expect(prereadPlan(PROMPT, { parts: { chat: true, system: false, lore: false }, recent: 6 })).toBeNull();
  });

  it('puts one system brief where the first replaced message stood, the rest in order', () => {
    const placed = placeBrief(PROMPT, [1, 3, 4], 'Notes', 3);
    expect(placed.messages.map(({ content }) => content)).toEqual(['Rules', 'Notes', 'Records', 'A secret', 'with a picture', 'third', 'latest', 'Answer']);
    expect(placed.messages[1]!.role).toBe('system');
    expect(placed.parts.map(({ from, tokens }) => [from.kind, tokens])).toEqual([['block', 1], ['preread', 3], ['block', 3], ['depth', 6], ['block', 7], ['block', 8], ['block', 9], ['answer', 10]]);
  });

  it('reuses a brief for what it covers and leaves what it does not raw, counted', () => {
    const before = sent([MAIN, CASTLE, said('a', 'user', 'first'), said('b', 'assistant', 'second'), said('c', 'user', 'latest')]);
    const { covered } = prereadPlan(before, ALL)!;
    const next = sent([MAIN, CASTLE, said('a', 'user', 'first'), said('b', 'assistant', 'second'), said('c', 'user', 'latest'), said('d', 'assistant', 'reply'), said('e', 'user', 'newer')]);
    // c and d were not in the brief: c was the latest user message then, d did not exist.
    expect(coverage(next, prereadPlan(next, ALL)!, covered, new Set('abcde'))).toEqual({ replaced: [0, 1, 2, 3], uncovered: 5 + 6, stale: false });
  });

  it('goes stale on a covered chat message edited or gone, or a covered system text changed', () => {
    const before = sent([MAIN, said('a', 'user', 'first'), said('b', 'assistant', 'second'), said('c', 'user', 'latest')]);
    const { covered } = prereadPlan(before, ALL)!;
    const edited = sent([MAIN, said('a', 'user', 'first, edited'), said('b', 'assistant', 'second'), said('c', 'user', 'latest')]);
    expect(coverage(edited, prereadPlan(edited, ALL)!, covered, new Set('abc')).stale).toBe(true);
    const deleted = sent([MAIN, said('b', 'assistant', 'second'), said('c', 'user', 'latest')]);
    expect(coverage(deleted, prereadPlan(deleted, ALL)!, covered, new Set('bc')).stale).toBe(true);
    // Left out by the budget, it is still in the chat.
    expect(coverage(deleted, prereadPlan(deleted, ALL)!, covered, new Set('abc')).stale).toBe(false);
    const rules = sent([[MAIN[0], { role: 'system', content: 'New rules' }], said('a', 'user', 'first'), said('b', 'assistant', 'second'), said('c', 'user', 'latest')]);
    expect(coverage(rules, prereadPlan(rules, ALL)!, covered, new Set('abc')).stale).toBe(true);
  });

  it('does not go stale on a covered lorebook entry that did not fire or changed: the new text goes raw', () => {
    const before = sent([CASTLE, said('a', 'user', 'first'), said('b', 'user', 'latest')]);
    const { covered } = prereadPlan(before, ALL)!;
    const unfired = sent([said('a', 'user', 'first'), said('b', 'user', 'latest')]);
    expect(coverage(unfired, prereadPlan(unfired, ALL)!, covered, new Set('ab'))).toEqual({ replaced: [0], uncovered: 0, stale: false });
    const changed = sent([[CASTLE[0], { role: 'system', content: 'The castle burned' }], said('a', 'user', 'first'), said('b', 'user', 'latest')]);
    expect(coverage(changed, prereadPlan(changed, ALL)!, covered, new Set('ab'))).toEqual({ replaced: [1], uncovered: 1, stale: false });
  });

  it('counts the saving at the chat model input price less the call, and nothing where a price is unknown', () => {
    const price = { input: 2, output: 8, cacheRead: null, cacheWrite: null, tiers: [] };
    const spent = { unit: 'usd' as const, amount: 0.001, source: 'reported' as const };
    expect(savedCost(10_000, price, 'usd', spent)?.amount).toBeCloseTo(0.019);
    expect(savedCost(100, price, 'usd', spent)?.amount).toBeCloseTo(-0.0008);
    expect(savedCost(-100, price, 'usd', { ...spent, amount: 0 })?.amount).toBeCloseTo(-0.0002);
    expect(savedCost(10_000, undefined, 'usd', spent)).toBeNull();
    expect(savedCost(10_000, price, 'usd', null)).toBeNull();
    expect(savedCost(10_000, price, 'credit', spent)).toBeNull();
  });
});
