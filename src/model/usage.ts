import type { Cost } from '../connectors/types';
import type { Receipt } from './chat';
import { grouped } from './fields';

type Tally = { total: number; unknown: number };
// Unknown counts stay separate from known sums; never add costs across units.
// Any price-list component makes the aggregate estimated. cache: the cache reads and input of the calls that report both.
export type ModelUsage = { calls: number; last: number | null; input: Tally; output: Tally; cache: { read: number; input: number }; costs: { unit: Cost['unit']; amount: number; estimated: boolean }[]; costUnknown: number };

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
export function book(booked: Map<string, Cost | null>, call: string, cost: Cost | null) {
  if (!booked.get(call)) booked.set(call, cost);
}

export function counted(rows: Iterable<Ledger>): Counted[] {
  const calls = new Map<string, Counted>();
  const booked = new Map<string, Cost | null>();
  for (const row of rows) {
    if (row.type === 'call') calls.set(row.call.id, { at: row.at, call: row.call, chat: row.chat, character: row.character });
    else if (row.type === 'cost') book(booked, row.call, row.cost);
  }
  return [...calls.values()].map((one) => (one.call.cost === 'pending' && booked.has(one.call.id) ? { ...one, call: { ...one.call, cost: booked.get(one.call.id)! } } : one));
}

function sum(made: Iterable<UsageCall>): ModelUsage {
  const usage: ModelUsage = { calls: 0, last: null, input: { total: 0, unknown: 0 }, output: { total: 0, unknown: 0 }, cache: { read: 0, input: 0 }, costs: [], costUnknown: 0 };
  const add = (tally: Tally, value: number | null) => (value === null ? tally.unknown++ : (tally.total += value));
  for (const { at, call } of made) {
    usage.calls++;
    usage.last = Math.max(usage.last ?? 0, at);
    add(usage.input, call.usage?.inputTokens ?? null);
    add(usage.output, call.usage?.outputTokens ?? null);
    const { inputTokens, cachedInputTokens } = call.usage ?? {};
    if (inputTokens != null && cachedInputTokens != null) {
      usage.cache.read += cachedInputTokens;
      usage.cache.input += inputTokens;
    }
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

export type UsageWindow = 'hour' | 'today' | 'week' | 'month' | 'year';

// In local time: today from midnight, the week from Monday's midnight, the month and the year from their first day's.
export function windowStart(window: UsageWindow, now: number): number {
  if (window === 'hour') return now - 3_600_000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (window === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (window === 'month') start.setDate(1);
  if (window === 'year') start.setMonth(0, 1);
  return start.getTime();
}

export function connectionUsage(calls: Counted[], connection: string, now: number): Record<'hour' | 'today' | 'week', ModelUsage> {
  const made = calls.filter(({ call }) => call.connection === connection);
  const since = (window: UsageWindow) => sum(made.filter(({ at }) => at >= windowStart(window, now)));
  return { hour: since('hour'), today: since('today'), week: since('week') };
}

export type UsageGroup<K> = { key: K; usage: ModelUsage };
type ModelGroup = UsageGroup<string> & Pick<UsageCall['call'], 'connection' | 'model' | 'modelName' | 'source'>;
export type ReportWindow = 'month' | 'year' | 'all';
// A character no longer kept counts under one group of its own, not one per id.
export const GONE = 'gone';
// Days with calls in a row, by their local midnights, both ends included.
export type Streak = { from: number; to: number; days: number };

// days: every local day of the window's calendar (the whole month, the whole year, every year since the first call's),
// oldest first, days still to come included. hours: calls by weekday, Monday first, and hour. saved: what the cache
// saved, per unit, an estimate at today's prices; savedUnknown counts the calls it could not price. Other axes sort busiest first; a null character is no character.
export type UsageReport = {
  total: ModelUsage;
  days: UsageGroup<number>[];
  active: number;
  current: Streak | null;
  longest: Streak | null;
  busiest: { day: UsageGroup<number>; week: UsageGroup<number>[] } | null;
  hours: number[][];
  saved: { unit: Cost['unit']; amount: number }[];
  savedUnknown: number;
  models: ModelGroup[];
  characters: UsageGroup<string | null>[];
  chats: number;
};

const dayOf = (at: number) => windowStart('today', at);
const nextDay = (day: number, by = 1) => {
  const next = new Date(day);
  next.setDate(next.getDate() + by);
  return next.getTime();
};

export function usageReport(calls: Counted[], window: ReportWindow, now: number, character: (id: string) => boolean, saving: (one: Counted) => Cost | null): UsageReport {
  const first = window === 'all' ? calls.reduce((least, { at }) => Math.min(least, at), now) : now;
  const since = windowStart(window === 'month' ? 'month' : 'year', first);
  const end = new Date(now);
  if (window === 'month') end.setMonth(end.getMonth() + 1, 0);
  else end.setMonth(11, 31);
  const shown = calls.filter(({ at }) => at >= since);
  const group = <K>(made: Counted[], keyOf: (one: Counted) => K): UsageGroup<K>[] =>
    [...grouped(made, keyOf)].map(([key, each]) => ({ key, usage: sum(each) })).sort((a, b) => b.usage.calls - a.usage.calls);
  const byDay = grouped(calls, ({ at }) => dayOf(at));
  const dayGroup = (day: number): UsageGroup<number> => ({ key: day, usage: sum(byDay.get(day) ?? []) });
  const days: UsageGroup<number>[] = [];
  for (let day = since; day <= end.getTime(); day = nextDay(day)) days.push(dayGroup(day));

  const runs = days.reduce<Streak[]>((made, { key, usage }, index) => {
    if (!usage.calls) return made;
    const last = made.at(-1);
    if (last && days[index - 1]?.key === last.to) made[made.length - 1] = { ...last, to: key, days: last.days + 1 };
    else made.push({ from: key, to: key, days: 1 });
    return made;
  }, []);
  const longest = runs.reduce<Streak | null>((best, run) => (run.days > (best?.days ?? 0) ? run : best), null);
  // Today is not over: a run that reached yesterday still stands until today ends without a call.
  let last = dayOf(now);
  if (!byDay.has(last)) last = nextDay(last, -1);
  let from = last;
  while (byDay.has(nextDay(from, -1))) from = nextDay(from, -1);
  const current = byDay.has(last) ? { from, to: last, days: Math.round((last - from) / 86_400_000) + 1 } : null;

  const busiestDay = days.reduce<UsageGroup<number> | null>((best, day) => (day.usage.calls > (best?.usage.calls ?? 0) ? day : best), null);
  const monday = busiestDay && windowStart('week', busiestDay.key);
  const hours = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const saved = new Map<Cost['unit'], number>();
  let savedUnknown = 0;
  for (const one of shown) {
    const at = new Date(one.at);
    hours[(at.getDay() + 6) % 7]![at.getHours()]!++;
    const save = saving(one);
    if (save) saved.set(save.unit, (saved.get(save.unit) ?? 0) + save.amount);
    else savedUnknown++;
  }

  const named = new Map<string, UsageCall>();
  const modelKey = ({ call }: UsageCall) => `${call.connection}\n${call.model}`;
  for (const one of shown) if ((named.get(modelKey(one))?.at ?? -Infinity) <= one.at) named.set(modelKey(one), one);
  return {
    total: sum(shown),
    days,
    active: days.filter(({ usage }) => usage.calls).length,
    current,
    longest,
    busiest: busiestDay && { day: busiestDay, week: Array.from({ length: 7 }, (_, index) => dayGroup(nextDay(monday!, index))) },
    hours,
    saved: [...saved].map(([unit, amount]) => ({ unit, amount })),
    savedUnknown,
    models: group(shown, modelKey).map((entry) => {
      const { connection, model, modelName, source } = named.get(entry.key)!.call;
      return { ...entry, connection, model, modelName, source };
    }),
    characters: group(shown, ({ character: id }) => (id === null || character(id) ? id : GONE)),
    chats: new Set(shown.flatMap(({ chat }) => (chat === null ? [] : [chat]))).size,
  };
}
