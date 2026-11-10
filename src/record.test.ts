import { expect, it } from 'vitest';
import { isRecord } from './record';

it('a record is a plain object, never an array or null', () => {
  expect(isRecord({})).toBe(true);
  expect(isRecord({ a: 1 })).toBe(true);
  expect(isRecord([])).toBe(false);
  expect(isRecord(null)).toBe(false);
  expect(isRecord('text')).toBe(false);
});
