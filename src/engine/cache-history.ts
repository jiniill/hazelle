import type { CacheForecast, CacheRecurrence, CacheShortfall } from '../model/cache';
import type { Receipt } from '../model/chat';

const RECENT = 10;

// short: a reply's shortfall verdict (cacheShortfall), null where it cannot be judged: nothing forecast to read, or no
// reported read. Asked of the recent replies only.
export function cacheRecurrence(receipts: Receipt[], short: (receipt: Receipt) => boolean | null): CacheRecurrence {
  const recent = receipts.slice(0, RECENT).map((receipt) => ({ receipt, short: short(receipt) }));
  const judged = recent.filter(({ short }) => short !== null);
  const head = judged[0];
  const end = judged.findIndex(({ receipt, short }) => !short || receipt.connection !== head!.receipt.connection);
  const result: CacheRecurrence = { considered: 0, missing: 0, broken: 0, short: 0, causes: [], streak: head?.short ? { connection: head.receipt.connection, count: end < 0 ? judged.length : end } : null };
  for (const { receipt: { forecast }, short } of recent) {
    if (!forecast) { result.missing++; continue; }
    result.considered++;
    if (short) result.short++;
    const cause = forecast.broken;
    if (cause || short) result.broken++;
    if (!cause) continue;
    const key = (value: typeof cause) => JSON.stringify([value.kind, 'from' in value ? value.from : null]);
    const held = result.causes.find((item) => key(item.cause) === key(cause));
    if (held) held.count++;
    else result.causes.push({ cause, count: 1 });
  }
  return result;
}

// More than the two broken sends a recurrence line takes: this warns about the next send, from what the provider alone saw.
const STREAK = 3;

// The shortfalls in a row on the next send's connection, when they are enough to warn of; null otherwise.
export const shortStreak = ({ streak }: CacheRecurrence, connection: string) => (streak && streak.connection === connection && streak.count >= STREAK ? streak.count : null);

export function cacheShortfall(forecast: CacheForecast | undefined, actual: number | null, ratio: number | null): CacheShortfall | null {
  if (!forecast || forecast.read <= 0 || actual === null) return null;
  const expected = forecast.read * (ratio ?? 1);
  return { expected, actual, ratio, short: actual < expected / 2 && expected - actual >= 128 };
}

// Cache reads end at whole-part boundaries; choose the boundary nearest the o200k reach, allowing tokenizer noise.
export function readReach(parts: { tokens: number }[], { actual, ratio }: CacheShortfall): number | null {
  const reach = actual / (ratio ?? 1);
  let sum = 0;
  let best = 0;
  let gap = reach;
  for (const [index, { tokens }] of parts.entries()) {
    sum += tokens;
    const off = Math.abs(sum - reach);
    if (off < gap) {
      best = index + 1;
      gap = off;
    }
  }
  return best < parts.length ? best : null;
}
