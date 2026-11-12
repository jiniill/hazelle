import { expect, it } from 'vitest';
import { linearLevels, quartileLevels } from './levels';

it('steps days by quartile of the busy ones, the top step only the busiest fifth, and keeps an empty day at 0', () => {
  expect(quartileLevels([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual([0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4]);
  expect(quartileLevels([0, 0])).toEqual([0, 0]);
  expect(quartileLevels([5, 5, 5])).toEqual([1, 1, 1]);
});

it('steps hours straight to the busiest one', () => {
  expect(linearLevels([0, 2, 4, 7, 10])).toEqual([0, 1, 2, 3, 4]);
});
