import { describe, expect, it } from 'vitest';
import { readCount, readTyped, readWhole } from './typedNumber';

describe('readTyped', () => {
  it('reads a number and words each way it can be wrong', () => {
    expect(readTyped('0.7', false)).toEqual({ ok: true, value: 0.7 });
    expect(readTyped('abc', false)).toEqual({ ok: false, error: '숫자를 입력해 주세요.' });
    expect(readTyped('1.5', true)).toEqual({ ok: false, error: '정수를 입력해 주세요.' });
  });
});

it('reads a count from one and a whole number from zero, refusing what is below or not whole', () => {
  expect(['0', '3', '-1', '1.5'].map(readCount)).toEqual([null, 3, null, null]);
  expect(['0', '3', '-1', '1.5'].map(readWhole)).toEqual([0, 3, null, null]);
  expect([readCount.error, readWhole.error]).toEqual(['1 이상의 정수를 입력해 주세요.', '0 이상의 정수를 입력해 주세요.']);
});
