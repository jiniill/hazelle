import { expect, it } from 'vitest';
import { linkState } from './link';

it('lights a mark sharing a key, dims the rest of its group and leaves other groups alone', () => {
  const active = ['day:3', 'day:4'];
  expect(linkState(active, ['day:4', 'month:1'])).toBe('lit');
  expect(linkState(active, ['day:5', 'month:1'])).toBe('dim');
  expect(linkState(active, ['hour:3'])).toBeNull();
  expect(linkState([], ['day:4'])).toBeNull();
});
