import type { KeyboardEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { stepByKey, strokeStep } from './pages';

// An element of that tag, as far as closest() tells.
const element = (tag: string) => ({ closest: (selector: string) => (selector.split(', ').includes(tag) ? {} : null) });

const press = (key: string, target: ReturnType<typeof element>, shiftKey = false) =>
  ({ key, code: '', target, shiftKey, altKey: false, ctrlKey: false, metaKey: false, nativeEvent: { isComposing: false, keyCode: 0 }, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

it('steps with ← →, and leaves the arrows to a field, a video and a held modifier', () => {
  const onStep = vi.fn();
  const pages = { at: 0, count: 3, onStep };
  stepByKey(pages, press('ArrowLeft', element('button')));
  stepByKey(pages, press('ArrowRight', element('button')));
  expect(onStep.mock.calls).toEqual([[-1], [1]]);

  onStep.mockClear();
  stepByKey(pages, press('ArrowRight', element('input')));
  stepByKey(pages, press('ArrowRight', element('video')));
  stepByKey(pages, press('ArrowRight', element('button'), true));
  stepByKey(pages, press('Enter', element('button')));
  expect(onStep).not.toHaveBeenCalled();
});

it('steps on a long sideways stroke, leftwards to the next, and leaves a short or mostly vertical one to the scroll', () => {
  const from = { x: 200, y: 300 };
  expect(strokeStep(from, { x: 100, y: 310 })).toBe(1);
  expect(strokeStep(from, { x: 300, y: 290 })).toBe(-1);
  expect(strokeStep(from, { x: 170, y: 300 })).toBe(0);
  expect(strokeStep(from, { x: 120, y: 400 })).toBe(0);
});
