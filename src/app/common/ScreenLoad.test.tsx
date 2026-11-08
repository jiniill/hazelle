import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { ScreenLoad, screenChunk } from './ScreenLoad';

let failures = 0;
let waits = 0;
vi.mock('../ui', () => ({
  Screen: ({ children }: { children: unknown }) => children,
  Intro: () => {
    failures++;
    return null;
  },
  Button: () => null,
  Progress: () => {
    waits++;
    return null;
  },
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

it('draws a started chunk that has arrived without suspending, and forgets a failed start so the next one loads again', async () => {
  const Done = () => 'done';
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ Done });
  const { Screen, start } = screenChunk(load, (module: { Done: typeof Done }) => module.Done);
  await start();
  await start();
  expect(load).toHaveBeenCalledTimes(2);
  const root = probeRoot();
  waits = 0;
  await act(() => root.render(<ScreenLoad><Screen /></ScreenLoad>));
  expect(waits).toBe(0);
  expect(load).toHaveBeenCalledTimes(2);
  await act(() => root.unmount());
});
