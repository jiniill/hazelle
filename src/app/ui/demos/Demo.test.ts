import { expect, it } from 'vitest';
import { nextRound } from './Demo';

it('alternates a demo of two ways each round until one is picked, then replays the picked one', () => {
  const start = { way: 0 as const, held: false, count: 0 };
  expect(nextRound(start, true)).toEqual({ way: 1, held: false, count: 1 });
  expect(nextRound({ ...start, held: true }, true)).toEqual({ way: 0, held: true, count: 1 });
  expect(nextRound(start, false)).toEqual({ way: 0, held: false, count: 1 });
});
