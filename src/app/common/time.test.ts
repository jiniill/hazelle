import { expect, it } from 'vitest';
import { moment } from './time';

it("names a moment's day and time, and its year when it is another year's", () => {
  const now = new Date(2026, 10, 14, 12).getTime();
  expect(moment(new Date(2026, 10, 13, 2, 49).getTime(), now)).toBe('11월 13일 오전 2:49');
  expect(moment(new Date(2025, 11, 20, 15, 5).getTime(), now)).toBe('2025년 12월 20일 오후 3:05');
});
