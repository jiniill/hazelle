import { describe, expect, it } from 'vitest';
import { loggedCalls, usageCall, type Entry, type Receipt } from './chat';
import { connectionUsage, counted, GONE, modelUsage, usageReport, windowStart, type Ledger, type UsageCall } from './usage';
import type { Stored } from './kinds';

let rev = 0;
const entry = (id: string, value: Entry): Stored<'entry'> => ({ id, kind: 'entry', parent: 'chat', rev: ++rev, value });
const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: crypto.randomUUID(),
  connection: 'c1',
  source: 'OpenRouter',
  model: 'm1',
  modelName: 'Model One',
  state: 'done',
  cut: null,
  error: null,
  finishReason: 'stop',
  usage: null,
  cost: null,
  replyId: null,
  firstTextMs: 100,
  totalMs: 900,
  cache: null,
  ...over,
});
const bot = (id: string, text: string, over?: Partial<Receipt>) =>
  entry(id, { type: 'message', role: 'assistant', at: rev, text, receipt: receipt(over) });

const row = ({ at, call }: UsageCall, chat: string | null = 'chat', character: string | null = null): Ledger => ({ type: 'call', at, call, chat, character });
const calls = (...made: UsageCall[]) => counted(made.map((one) => row(one)));

describe('counted', () => {
  it('books a later cost onto a pending call, a known one over a failed lookup, and leaves a settled call as it was', () => {
    const pending = usageCall(receipt({ id: 'pending', cost: 'pending' }), 10);
    const settled = usageCall(receipt({ id: 'settled', cost: { unit: 'usd', amount: 0.5, source: 'price-list' } }), 11);
    const cost = (call: string, booked: Extract<Ledger, { type: 'cost' }>['cost']): Ledger => ({ type: 'cost', call, cost: booked, at: 12 });
    const reported = { unit: 'usd' as const, amount: 0.25, source: 'reported' as const };
    expect(counted([row(pending), row(settled), cost('pending', null), cost('pending', reported), cost('pending', null), cost('settled', reported)]).map(({ call }) => call.cost))
      .toEqual([reported, { unit: 'usd', amount: 0.5, source: 'price-list' }]);
  });
});

describe('loggedCalls', () => {
  it('keeps a deleted message’s call, every translation’s, an edited reply’s once, and books a cost on each call of its reply', () => {
    const reply = receipt({ cost: 'pending', replyId: 'reply' });
    const translated = receipt({ cost: 'pending', replyId: 'reply' });
    const again = receipt();
    const reported = { unit: 'usd' as const, amount: 0.5, source: 'reported' as const };
    const made = loggedCalls([
      { type: 'message', role: 'assistant', at: 1, text: '답', receipt: reply },
      { type: 'translation', version: 'm1', at: 2, text: '번역', receipt: translated },
      { type: 'translation', version: 'm1', at: 3, text: '다시 번역', receipt: again },
      { type: 'version', message: 'm1', replaces: 'm1', edit: true, at: 4, text: '고친 답', receipt: reply },
      { type: 'delete', message: 'm1', at: 5 },
      { type: 'cost', replyId: 'reply', cost: reported, at: 6 },
    ]);
    expect(made.calls.map(({ at, call }) => [call.id, at])).toEqual([[reply.id, 1], [translated.id, 2], [again.id, 3]]);
    expect(made.booked).toEqual([{ call: reply.id, cost: reported }, { call: translated.id, cost: reported }]);
  });
});

describe('loggedCalls of a state write', () => {
  it('keeps its call, the call of one written again too, and none for a change made by hand', () => {
    const [first, again] = [receipt(), receipt()];
    const made = loggedCalls([
      { type: 'status', version: 'm1', of: ['d'], changes: [], receipt: first, at: 1 },
      { type: 'status', version: 'm1', of: ['d'], changes: [], receipt: again, at: 2 },
      { type: 'status', version: 'm1', of: ['d'], changes: [], receipt: null, at: 3 },
      { type: 'status', version: 'm1', changes: [], at: 4, byHand: true },
    ]);
    expect(made.calls.map(({ at, call }) => [call.id, at])).toEqual([[first.id, 1], [again.id, 2]]);
  });
});

describe('modelUsage', () => {
  it('sums costs separately by unit, marking only the unit with a price-list cost as estimated', () => {
    const made = calls(
      usageCall(receipt({ cost: { unit: 'usd', amount: 0.5, source: 'reported' } }), 10),
      usageCall(receipt({ cost: { unit: 'credit', amount: 2, source: 'price-list' } }), 11),
      usageCall(receipt({ cost: { unit: 'usd', amount: 0.25, source: 'reported' } }), 12),
      usageCall(receipt({ cost: { unit: 'credit', amount: 3, source: 'reported' } }), 13),
    );
    expect(modelUsage(made, 'c1', 'm1')).toMatchObject({
      calls: 4,
      costs: [{ unit: 'usd', amount: 0.75, estimated: false }, { unit: 'credit', amount: 5, estimated: true }],
      costUnknown: 0,
    });
  });

  it('counts each call of a continued reply and keeps what was not reported apart', () => {
    const cut = receipt({ usage: { inputTokens: 100, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 50, reasoningTokens: null }, cost: { unit: 'usd', amount: 0.5, source: 'reported' }, totalMs: 500 });
    const continued = receipt({ continues: cut, cost: { unit: 'usd', amount: 0.25, source: 'price-list' } });
    const made = [bot('b1', '하나', continued), bot('b2', '둘', { model: 'm2' })];
    expect(modelUsage(calls(...loggedCalls(made.map(({ value }) => value)).calls), 'c1', 'm1')).toEqual({
      calls: 2,
      last: made[0]!.value.at,
      input: { total: 100, unknown: 1 },
      output: { total: 50, unknown: 1 },
      costs: [{ unit: 'usd', amount: 0.75, estimated: true }],
      costUnknown: 0,
    });
  });
});

describe('connectionUsage', () => {
  it('counts one connection’s calls over the last hour, today and this week from Monday', () => {
    const now = new Date(2026, 9, 7, 12, 30).getTime(); // a Wednesday
    const call = (id: string, at: number, connection = 'c1') => ({ at, call: { id, connection, model: 'm1', modelName: 'm1', source: connection, usage: { inputTokens: 10, cachedInputTokens: null, cacheWriteInputTokens: null, outputTokens: 5, reasoningTokens: null }, cost: null } });
    const recent = call('recent', now - 60_000);
    const original = [recent, call('morning', new Date(2026, 9, 7, 0, 0).getTime()), call('monday', new Date(2026, 9, 5, 0, 0).getTime()), call('sunday', new Date(2026, 9, 4, 23, 59).getTime()), call('other', now, 'c2')];
    const usage = connectionUsage(calls(...original), 'c1', now);
    expect([usage.hour.calls, usage.today.calls, usage.week.calls]).toEqual([1, 2, 3]);
    expect(usage.week).toMatchObject({ input: { total: 30, unknown: 0 }, output: { total: 15, unknown: 0 }, costUnknown: 3 });
  });
});

describe('usageReport', () => {
  it('counts by day, model, character and chat, the chats and characters no longer kept together, apart from no chat', () => {
    const on = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
    const call = (id: string, at: number, model = 'm1') => ({ at, call: { id, connection: 'c1', model, modelName: model.toUpperCase(), source: 'C1', usage: null, cost: null } });
    const kept = { chat: (id: string) => id === 'kept', character: (id: string) => id === 'k1' };
    const report = usageReport(counted([
      row(call('a', on(13)), 'kept', 'k1'),
      row(call('b', on(14), 'm2'), 'kept', 'k1'),
      row(call('c', on(14, 9)), 'deleted', 'k1'),
      row(call('d', on(14, 10)), 'purged', 'gone'),
      row(call('profile', on(14)), null, 'k2'),
      row(call('old', on(1)), 'kept', null),
    ]), 'week', on(14, 18), kept); // a Wednesday
    expect(report.total.calls).toBe(5);
    expect(report.periods.map(({ key, usage }) => [key, usage.calls])).toEqual([[on(12, 0), 0], [on(13, 0), 1], [on(14, 0), 4], [on(15, 0), 0], [on(16, 0), 0], [on(17, 0), 0], [on(18, 0), 0]]);
    expect(report.models.map(({ model, modelName, usage }) => [model, modelName, usage.calls])).toEqual([['m1', 'M1', 4], ['m2', 'M2', 1]]);
    expect(report.characters.map(({ key, usage }) => [key, usage.calls])).toEqual([['k1', 3], [GONE, 2]]);
    expect(report.chats.map(({ key, usage }) => [key, usage.calls])).toEqual([['kept', 2], [GONE, 2], [null, 1]]);
  });

  it('runs over all time a month at a time from the first call’s, an empty month too', () => {
    const call = (id: string, at: number) => ({ at, call: { id, connection: 'c1', model: 'm1', modelName: 'm1', source: 'C1', usage: null, cost: null } });
    const report = usageReport(calls(call('august', new Date(2026, 7, 30).getTime()), call('october', new Date(2026, 9, 2).getTime())), 'all', new Date(2026, 9, 7).getTime(), { chat: () => true, character: () => true });
    expect(report.periods.map(({ key, usage }) => [key, usage.calls])).toEqual([[new Date(2026, 7, 1).getTime(), 1], [new Date(2026, 8, 1).getTime(), 0], [new Date(2026, 9, 1).getTime(), 1]]);
  });

  it('starts the month at its first day’s local midnight', () => {
    expect(windowStart('month', new Date(2026, 9, 7, 12, 30).getTime())).toBe(new Date(2026, 9, 1).getTime());
  });
});

