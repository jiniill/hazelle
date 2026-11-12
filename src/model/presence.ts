import { windowStart } from './usage';

export const MINUTE = 60_000;
// A minute counts while the page is visible and was used at most this long ago.
const IDLE_AFTER = 5 * MINUTE;

// One device's minutes in one UTC month: runs holds [offset, length] pairs, ascending, apart and in minutes from start,
// itself in minutes since the epoch, so a time zone or a clock change never moves or doubles a minute.
export type Presence = { start: number; runs: number[] };

export const counts = (now: number, used: number, visible: boolean) => visible && now - used <= IDLE_AFTER;

export const minuteOf = (at: number) => Math.floor(at / MINUTE);

export function monthOf(minute: number): number {
  const at = new Date(minute * MINUTE);
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1) / MINUTE;
}

function* minutesIn({ start, runs }: Presence): Generator<number> {
  for (let at = 0; at < runs.length; at += 2) for (let one = 0; one < runs[at + 1]!; one++) yield start + runs[at]! + one;
}

const ordered = (minutes: Iterable<number>) => [...new Set(minutes)].sort((a, b) => a - b);

// minutes: all in the month that starts at start.
export function marked(start: number, held: Presence | null, minutes: readonly number[]): Presence {
  const runs: number[] = [];
  for (const minute of ordered([...(held ? minutesIn(held) : []), ...minutes])) {
    const offset = minute - start;
    if (runs.length && runs.at(-2)! + runs.at(-1)! === offset) runs[runs.length - 1]!++;
    else runs.push(offset, 1);
  }
  return { start, runs };
}

// days: minutes present per local midnight from since on; present: how many such days; first: the local midnight of the
// first minute ever kept, before since too, null while none is.
export type PresenceReport = { days: Map<number, number>; minutes: number; present: number; first: number | null };

// Two devices or tabs open in one minute count it once.
export function presenceReport(held: Iterable<Presence>, since: number): PresenceReport {
  const minutes = ordered([...held].flatMap((one) => [...minutesIn(one)]));
  const days = new Map<number, number>();
  let day = -Infinity;
  let next = -Infinity;
  let total = 0;
  for (const minute of minutes) {
    const at = minute * MINUTE;
    if (at < since) continue;
    if (at >= next) {
      day = windowStart('today', at);
      // A day is 23 to 25 hours long: 36 hours on is always within the next one.
      next = windowStart('today', day + 36 * 3_600_000);
    }
    days.set(day, (days.get(day) ?? 0) + 1);
    total++;
  }
  return { days, minutes: total, present: days.size, first: minutes.length ? windowStart('today', minutes[0]! * MINUTE) : null };
}
