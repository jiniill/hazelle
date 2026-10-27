import type { Meter } from '../connectors/types';

const DAY_MS = 24 * 60 * 60 * 1000;

// used and even: percent of the allowance spent, and what an even spend over the window would have spent by now.
// perDay: what would spend the rest evenly by the window's end. endsAtSwitch: the window ends at the group's switch,
// before the allowance resets.
export type Pace = { used: number; even: number; perDay: number; daysLeft: number; endsAtSwitch: boolean };

// One month before, in UTC as the reset is counted; a day the month lacks becomes its last.
export function previousReset(at: number): number {
  const reset = new Date(at);
  const month = reset.getUTCMonth() - 1;
  const last = new Date(Date.UTC(reset.getUTCFullYear(), month + 1, 0)).getUTCDate();
  return Date.UTC(reset.getUTCFullYear(), month, Math.min(reset.getUTCDate(), last), reset.getUTCHours(), reset.getUTCMinutes(), reset.getUTCSeconds(), reset.getUTCMilliseconds());
}

// Intersect the allowance window with the group turn; unknown inputs stay null, never invented figures.
export function pace(meter: Meter, now: number, turn: { start: number; end: number } | null): Pace | null {
  if (meter.kind !== 'left' || meter.limit === null || meter.limit <= 0 || meter.resets === null || typeof meter.resets === 'string') return null;
  let start = previousReset(meter.resets.at);
  let end = meter.resets.at;
  let endsAtSwitch = false;
  if (turn) {
    start = Math.max(start, turn.start);
    if (turn.end < end) {
      end = turn.end;
      endsAtSwitch = true;
    }
  }
  if (end <= start || now < start || now > end) return null;
  const share = (part: number) => Math.round(Math.max(0, Math.min(1, part)) * 100);
  const days = (end - now) / DAY_MS;
  return {
    used: share((meter.limit - meter.amount) / meter.limit),
    even: share((now - start) / (end - start)),
    perDay: meter.amount / Math.max(days, 1),
    daysLeft: Math.ceil(days),
    endsAtSwitch,
  };
}

// More than this many points from the even mark reads as fast or slow, not as on pace.
const LEEWAY = 10;

export function verdict({ used, even }: Pace): 'fast' | 'even' | 'slow' {
  return used - even > LEEWAY ? 'fast' : even - used > LEEWAY ? 'slow' : 'even';
}
