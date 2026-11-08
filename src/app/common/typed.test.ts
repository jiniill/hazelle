import { act, createElement, useState } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { typedText, useTypedNumber } from './typed';
import { reader } from './typedNumber';

const read = reader((typed) => (Number.isFinite(Number(typed)) && typed.trim() !== '' ? Number(typed) : null), '숫자를 입력해 주세요.');

it('keeps a text as typed while it reads as the value or as no value, and shows a value set from elsewhere', () => {
  expect(typedText('0.50', read, 0.5, String)).toBe('0.50');
  expect(typedText('0.', read, 0, String)).toBe('0.');
  expect(typedText('abc', read, 7, String)).toBe('abc');
  expect(typedText('0.5', read, 0.9, String)).toBe('0.9');
  expect(typedText(undefined, read, 0.9, String)).toBe('0.9');
});

it('keeps a text that is no value with its reader\'s error and hands on only values', async () => {
  const handed: number[] = [];
  let field: ReturnType<typeof useTypedNumber<number>>;
  let setFromElsewhere: (value: number) => void;
  function Probe() {
    const [value, setValue] = useState(3);
    setFromElsewhere = setValue;
    field = useTypedNumber(read, value, { onChange: (next) => {
      handed.push(next);
      setValue(next);
    } });
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(createElement(Probe)));
    await act(() => field!.change('abc'));
    expect([field!.text, field!.error, handed]).toEqual(['abc', '숫자를 입력해 주세요.', []]);
    await act(() => field!.change('4'));
    expect([field!.text, field!.error, handed]).toEqual(['4', undefined, [4]]);
    await act(() => setFromElsewhere!(9));
    expect(field!.text).toBe('9');
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
