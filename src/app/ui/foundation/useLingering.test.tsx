import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { useLingering } from './useLingering';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('keeps the last settled value through a short wait and gives way to a long one', () => {
  vi.useFakeTimers();
  const root = probeRoot();
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '200ms' }));
  let shown = '';
  const Probe = ({ value, waiting }: { value: string; waiting: boolean }) => {
    shown = useLingering(value, waiting);
    return null;
  };
  act(() => root.render(<Probe value="first" waiting={false} />));
  act(() => root.render(<Probe value="soon" waiting />));
  expect(shown).toBe('first');
  act(() => root.render(<Probe value="soon" waiting={false} />));
  expect(shown).toBe('soon');

  act(() => root.render(<Probe value="late" waiting />));
  act(() => void vi.advanceTimersByTime(199));
  expect(shown).toBe('soon');
  act(() => void vi.advanceTimersByTime(1));
  expect(shown).toBe('late');
  act(() => root.unmount());
});
