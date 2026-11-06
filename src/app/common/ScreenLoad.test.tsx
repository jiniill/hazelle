import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { ScreenLoad } from './ScreenLoad';

let failures = 0;
vi.mock('../ui', () => ({
  Screen: ({ children }: { children: unknown }) => children,
  Intro: () => {
    failures++;
    return null;
  },
  Button: () => null,
  Progress: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

it('keeps a screen that failed to its place, and draws the next place anew', async () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  let drawn = 0;
  const Broken = () => {
    throw new Error('broken');
  };
  const Fine = () => {
    drawn++;
    return null;
  };
  const root = probeRoot();
  await act(() => root.render(<ScreenLoad at="/a"><Broken /></ScreenLoad>));
  expect(failures).toBeGreaterThan(0);
  await act(() => root.render(<ScreenLoad at="/a"><Fine /></ScreenLoad>));
  expect(drawn).toBe(0);
  await act(() => root.render(<ScreenLoad at="/b"><Fine /></ScreenLoad>));
  expect(drawn).toBeGreaterThan(0);
  await act(() => root.unmount());
  quiet.mockRestore();
});
