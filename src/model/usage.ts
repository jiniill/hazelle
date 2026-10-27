import type { Cost } from '../connectors/types';
import type { Receipt } from './chat';

type Tally = { total: number; unknown: number };
// Unknown counts stay separate from known sums; never add costs across units.
// Any price-list component makes the aggregate estimated.
export type ModelUsage = { calls: number; last: number | null; input: Tally; output: Tally; costs: { unit: Cost['unit']; amount: number; estimated: boolean }[]; costUnknown: number };

// modelName and source: the names when the call was made, for a model or connection renamed or deleted since.
export type UsageCall = { at: number; call: Pick<Receipt, 'id' | 'connection' | 'model' | 'modelName' | 'source' | 'usage' | 'cost' | 'calibration'> };

// Append-only per-call ledger outlives chats; delayed costs get separate rows naming the call.
// chat null identifies non-chat tasks such as the translator or picture profiles.
export type Ledger =
  | { type: 'call'; at: number; call: UsageCall['call']; chat: string | null; character: string | null }
  | { type: 'input-refusal'; at: number; call: UsageCall['call']; chat: string | null; character: string | null }
  | { type: 'cost'; call: string; cost: Cost | null; at: number };

export type Counted = UsageCall & Pick<Extract<Ledger, { type: 'call' }>, 'chat' | 'character'>;

// A known booked cost wins over an unknown one when devices both look it up.
export function counted(rows: Iterable<Ledger>): Counted[] {
  const calls = new Map<string, Counted>();
  const booked = new Map<string, Cost | null>();
  for (const row of rows) {
    if (row.type === 'call') calls.set(row.call.id, { at: row.at, call: row.call, chat: row.chat, character: row.character });
    else if (row.type === 'cost' && !booked.get(row.call)) booked.set(row.call, row.cost);
  }
  return [...calls.values()].map((one) => (one.call.cost === 'pending' && booked.has(one.call.id) ? { ...one, call: { ...one.call, cost: booked.get(one.call.id)! } } : one));
}

function sum(made: Iterable<UsageCall>): ModelUsage {
  const usage: ModelUsage = { calls: 0, last: null, input: { total: 0, unknown: 0 }, output: { total: 0, unknown: 0 }, costs: [], costUnknown: 0 };
  const add = (tally: Tally, value: number | null) => (value === null ? tally.unknown++ : (tally.total += value));
  for (const { at, call } of made) {
    usage.calls++;
    usage.last = Math.max(usage.last ?? 0, at);
    add(usage.input, call.usage?.inputTokens ?? null);
    add(usage.output, call.usage?.outputTokens ?? null);
    const cost = call.cost === 'pending' ? null : call.cost;
    if (!cost) {
      usage.costUnknown++;
      continue;
    }
    const kept = usage.costs.find((entry) => entry.unit === cost.unit);
    if (kept) {
      kept.amount += cost.amount;
      kept.estimated ||= cost.source === 'price-list';
    } else usage.costs.push({ unit: cost.unit, amount: cost.amount, estimated: cost.source === 'price-list' });
  }
  return usage;
}

// model: the provider's id, so the copies of one model count as one (not a ModelRef, whose model is an entry's key).
export const modelUsage = (calls: Counted[], connection: string, model: string) =>
  sum(calls.filter(({ call }) => call.connection === connection && call.model === model));

export type UsageWindow = 'hour' | 'today' | 'week' | 'month';

// In local time: today from midnight, the week from Monday's midnight, the month from its first day's.
export function windowStart(window: UsageWindow, now: number): number {
  if (window === 'hour') return now - 3_600_000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (window === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (window === 'month') start.setDate(1);
  return start.getTime();
}

export function connectionUsage(calls: Counted[], connection: string, now: number): Record<'hour' | 'today' | 'week', ModelUsage> {
  const made = calls.filter(({ call }) => call.connection === connection);
  const since = (window: UsageWindow) => sum(made.filter(({ at }) => at >= windowStart(window, now)));
  return { hour: since('hour'), today: since('today'), week: since('week') };
}

export type UsageGroup<K> = { key: K; usage: ModelUsage };
export type ModelGroup = UsageGroup<string> & Pick<UsageCall['call'], 'connection' | 'model' | 'modelName' | 'source'>;
export type ReportWindow = Exclude<UsageWindow, 'hour'> | 'all';
// A chat or character no longer kept counts under one group of its own, not one per id.
export const GONE = 'gone';
export type Kept = { chat: (id: string) => boolean; character: (id: string) => boolean };

// Periods include empty/future slots, oldest first by local start; other axes sort busiest first.
// Null chat/character groups represent calls made without one.
export type UsageReport = { total: ModelUsage; periods: UsageGroup<number>[]; models: ModelGroup[]; characters: UsageGroup<string | null>[]; chats: UsageGroup<string | null>[] };

export function usageReport(calls: Counted[], window: ReportWindow, now: number, kept: Kept): UsageReport {
  const since = window === 'all' ? null : windowStart(window, now);
  const shown = calls.filter(({ at }) => since === null || at >= since);
  const group = <K>(keyOf: (one: Counted) => K): UsageGroup<K>[] => {
    const groups = new Map<K, UsageCall[]>();
    for (const one of shown) {
      const key = keyOf(one);
      const held = groups.get(key);
      if (held) held.push(one);
      else groups.set(key, [one]);
    }
    return [...groups].map(([key, made]) => ({ key, usage: sum(made) })).sort((a, b) => b.usage.calls - a.usage.calls);
  };
  const monthly = window === 'all';
  const startOf = (at: number) => windowStart(monthly ? 'month' : 'today', at);
  const made = new Map(group(({ at }) => startOf(at)).map(({ key, usage }) => [key, usage]));
  const periods: UsageGroup<number>[] = [];
  const first = since ?? Math.min(now, ...made.keys());
  const last = new Date(startOf(now));
  if (window === 'week') last.setDate(last.getDate() + 6 - ((last.getDay() + 6) % 7));
  if (window === 'month') last.setMonth(last.getMonth() + 1, 0);
  for (const day = new Date(startOf(first)); day <= last; monthly ? day.setMonth(day.getMonth() + 1) : day.setDate(day.getDate() + 1)) {
    periods.push({ key: day.getTime(), usage: made.get(day.getTime()) ?? sum([]) });
  }
  const named = new Map<string, UsageCall>();
  const modelKey = ({ call }: UsageCall) => `${call.connection}\n${call.model}`;
  for (const one of shown) if ((named.get(modelKey(one))?.at ?? -Infinity) <= one.at) named.set(modelKey(one), one);
  return {
    total: sum(shown),
    periods,
    models: group(modelKey).map((entry) => {
      const { connection, model, modelName, source } = named.get(entry.key)!.call;
      return { ...entry, connection, model, modelName, source };
    }),
    characters: group(({ character }) => (character === null || kept.character(character) ? character : GONE)),
    chats: group(({ chat }) => (chat === null || kept.chat(chat) ? chat : GONE)),
  };
}
