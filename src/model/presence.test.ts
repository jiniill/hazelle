import { expect, it } from 'vitest';
import { counts, marked, MINUTE, minuteOf, monthOf, presenceReport } from './presence';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const minute = (day: number, hour: number, minute = 0) => minuteOf(at(day, hour, minute));
const kept = (...minutes: number[]) => marked(monthOf(minutes[0]!), null, minutes);

it('counts a minute only while the page is visible and was used in the last five minutes', () => {
  const used = at(13, 9);
  expect(counts(used + 5 * MINUTE, used, true)).toBe(true);
  expect(counts(used + 5 * MINUTE + 1, used, true)).toBe(false);
  expect(counts(used, used, false)).toBe(false);
  expect(counts(used, -Infinity, true)).toBe(false);
});

it('keeps each minute in its UTC month and adds minutes to the runs a month holds', () => {
  const start = monthOf(minute(13, 9));
  expect(start * MINUTE).toBe(Date.UTC(2026, 10, 1));
  const first = marked(start, null, [start + 9]);
  expect(first).toEqual({ start, runs: [9, 1] });
  expect(marked(start, first, [start + 10, start, start + 9])).toEqual({ start, runs: [0, 1, 9, 2] });
});

it('counts a minute two devices or tabs both kept once', () => {
  const phone = kept(minute(13, 9), minute(13, 9, 1));
  const desk = kept(minute(13, 9, 1), minute(13, 9, 2), minute(13, 22));
  expect(presenceReport([phone, desk], 0)).toEqual({ days: new Map([[at(13, 0), 4]]), minutes: 4, present: 1, first: at(13, 0) });
});

it('gives minutes per local day from the period on, and the first day kept before it too', () => {
  const october = kept(minute(-1, 23, 59));
  const november = kept(minute(12, 23, 59), minute(13, 0), minute(13, 0, 1), minute(20, 8));
  expect(presenceReport([october, november], at(1, 0))).toEqual({
    days: new Map([[at(12, 0), 1], [at(13, 0), 2], [at(20, 0), 1]]),
    minutes: 4,
    present: 3,
    first: at(-1, 0),
  });
  expect(presenceReport([], at(1, 0))).toEqual({ days: new Map(), minutes: 0, present: 0, first: null });
});
