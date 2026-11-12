import { describe, expect, it } from 'vitest';
import { loggedCalls, usageCall, type Entry, type Receipt } from './chat';
import { connectionUsage, counted, GONE, modelUsage, usageReport, windowStart, type CallPurpose, type Ledger, type UsageCall } from './usage';
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

const row = ({ at, call }: UsageCall, chat: string | null = 'chat', character: string | null = null, purpose: CallPurpose | null = null): Ledger => ({ type: 'call', at, call, chat, character, purpose });
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

  it('books a purpose found later onto a call that kept none, never over one it kept', () => {
    const purpose = (call: string, booked: CallPurpose): Ledger => ({ type: 'purpose', call, purpose: booked, at: 12 });
    const made = counted([row(usageCall(receipt({ id: 'old' }), 10)), row(usageCall(receipt({ id: 'kept' }), 10), 'chat', null, 'reply'), row(usageCall(receipt({ id: 'lost' }), 11)), purpose('old', 'memory'), purpose('kept', 'script')]);
    expect(made.map(({ call, purpose }) => [call.id, purpose])).toEqual([['old', 'memory'], ['kept', 'reply'], ['lost', null]]);
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

  it('tells each call’s purpose by the entry and the receipt that keep it', () => {
    const [cut, reply, brief, agent, sent, later, bot, embedding, state] = Array.from({ length: 9 }, () => receipt()) as [Receipt, Receipt, Receipt, Receipt, Receipt, Receipt, Receipt, Receipt, Receipt];
    const calibration = { measurement: { kind: 'unavailable' as const, reason: 'preparation' as const }, fit: null, retries: [], eligible: true };
    const made = loggedCalls([
      { type: 'message', role: 'user', at: 1, text: 'sent', receipt: null, translation: { text: '보냄', receipt: sent, at: 1, sentIn: 'English' } },
      { type: 'message', role: 'assistant', at: 2, text: '답', receipt: { ...reply, continues: cut, preread: { material: 1, brief: 1, receipt: brief, saved: null }, agents: [{ agent: 'a', name: 'A', stage: 'pre', receipt: agent }] } },
      { type: 'translation', version: 'm1', at: 3, text: '번역', receipt: later },
      { type: 'call', version: 'm1', at: 4, receipt: { ...bot, calibration } },
      { type: 'call', version: 'm1', at: 5, receipt: embedding },
      { type: 'status', version: 'm1', of: ['d'], changes: [], receipt: state, at: 6 },
    ]);
    expect(Object.fromEntries(made.calls.map(({ call, purpose }) => [call.id, purpose]))).toEqual({
      [sent.id]: 'input', [cut.id]: 'reply', [reply.id]: 'reply', [brief.id]: 'preread', [agent.id]: 'agent', [later.id]: 'translation', [bot.id]: 'script', [embedding.id]: null, [state.id]: 'status',
    });
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
      cache: { read: 0, input: 0 },
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
  const on = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();
  const tokens = (input: number, cached: number | null) => ({ inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: null, outputTokens: 1, reasoningTokens: null });
  const call = (id: string, at: number, model = 'm1', usage: UsageCall['call']['usage'] = null) => ({ at, call: { id, connection: 'c1', model, modelName: model.toUpperCase(), source: 'C1', usage, cost: null } });
  const unpriced = () => null;

  it('lays out the whole month, and counts by model and character, the characters no longer kept together', () => {
    const report = usageReport(counted([
      row(call('a', on(9, 13)), 'one', 'k1'),
      row(call('b', on(9, 14), 'm2'), 'one', 'k1'),
      row(call('c', on(9, 14, 9)), 'two', 'gone-1'),
      row(call('d', on(9, 14, 10)), 'two', 'gone-2'),
      row(call('profile', on(9, 14)), null, null),
      row(call('september', on(8, 30)), 'one', 'k1'),
    ]), 'month', on(9, 14, 18), (id) => id === 'k1', unpriced);
    expect(report.total.calls).toBe(5);
    expect(report.days).toHaveLength(31);
    expect(report.days[0]!.key).toBe(on(9, 1, 0));
    expect(report.days.filter(({ usage }) => usage.calls).map(({ key, usage }) => [key, usage.calls])).toEqual([[on(9, 13, 0), 1], [on(9, 14, 0), 4]]);
    expect(report.active).toBe(2);
    expect(report.models.map(({ model, modelName, usage }) => [model, modelName, usage.calls])).toEqual([['m1', 'M1', 4], ['m2', 'M2', 1]]);
    expect(report.characters.map(({ key, usage }) => [key, usage.calls])).toEqual([['k1', 2], [GONE, 2], [null, 1]]);
    expect(report.chats).toBe(2);
  });

  it('counts calls by what they were for, the features’ purposes under their feature, the unknown last', () => {
    const used = (id: string, purpose: CallPurpose | null) => row(call(id, on(9, 14)), 'chat', null, purpose);
    const report = usageReport(counted([used('a', null), used('b', null), used('c', null), used('d', 'reply'), used('e', 'translation'), used('f', 'input'), used('g', 'note'), used('h', 'likeness')]), 'month', on(9, 14, 18), () => true, unpriced);
    expect(report.uses.map(({ key, usage }) => [key, usage.calls])).toEqual([['translate', 3], ['reply', 1], ['illustrate', 1], [null, 3]]);
  });

  it('keeps the current run standing through yesterday, finds the longest run in the window and the busiest day’s week', () => {
    const made = calls(call('a', on(9, 1)), call('b', on(9, 2)), call('c', on(9, 3)), call('c2', on(9, 3, 20)), call('d', on(9, 12)), call('e', on(9, 13)));
    const report = usageReport(made, 'month', on(9, 14, 8), () => true, unpriced);
    expect(report.longest).toEqual({ from: on(9, 1, 0), to: on(9, 3, 0), days: 3 });
    expect(report.current).toEqual({ from: on(9, 12, 0), to: on(9, 13, 0), days: 2 });
    expect(usageReport(made, 'month', on(9, 15, 8), () => true, unpriced).current).toBeNull();
    expect(report.busiest!.day.key).toBe(on(9, 3, 0));
    // The week runs from Monday 28 September, before the window.
    expect(report.busiest!.week.map(({ key, usage }) => [key, usage.calls])).toEqual([[on(8, 28, 0), 0], [on(8, 29, 0), 0], [on(8, 30, 0), 0], [on(9, 1, 0), 1], [on(9, 2, 0), 1], [on(9, 3, 0), 2], [on(9, 4, 0), 0]]);
  });

  it('counts hours by weekday, the cache over calls that report it, and the saving per unit with the calls it could not price', () => {
    const made = calls(call('wed', on(9, 14, 23), 'm1', tokens(100, 80)), call('thu', on(9, 15, 1), 'm1', tokens(50, null)), call('free', on(9, 15, 2), 'm2', tokens(10, 0)));
    const saving = ({ call: { model } }: { call: { model: string } }) => (model === 'm1' ? { unit: 'usd' as const, amount: 0.5, source: 'price-list' as const } : null);
    const report = usageReport(made, 'month', on(9, 16), () => true, saving);
    expect(report.hours[2]![23]).toBe(1);
    expect(report.hours[3]![1]).toBe(1);
    expect(report.total.cache).toEqual({ read: 80, input: 110 });
    expect(report.saved).toEqual([{ unit: 'usd', amount: 1 }]);
    expect(report.savedUnknown).toBe(1);
  });

  it('runs over all time from the first call’s year to the end of this one', () => {
    const report = usageReport(calls(call('old', new Date(2025, 5, 2).getTime())), 'all', on(9, 7), () => true, unpriced);
    expect(report.days[0]!.key).toBe(new Date(2025, 0, 1).getTime());
    expect(report.days.at(-1)!.key).toBe(new Date(2026, 11, 31).getTime());
  });

  it('starts the month and the year at their first day’s local midnight', () => {
    expect(windowStart('month', on(9, 7, 12))).toBe(on(9, 1, 0));
    expect(windowStart('year', on(9, 7, 12))).toBe(new Date(2026, 0, 1).getTime());
  });
});
