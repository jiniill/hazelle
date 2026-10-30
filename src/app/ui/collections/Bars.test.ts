import { expect, it } from 'vitest';
import { nearestBar } from './Bars';

it('lands a press between the bars on the closer one, and one past the end on the last', () => {
  const centers = [5, 16, 27];
  expect(nearestBar(10, centers)).toBe(0);
  expect(nearestBar(11, centers)).toBe(1);
  expect(nearestBar(300, centers)).toBe(2);
});
