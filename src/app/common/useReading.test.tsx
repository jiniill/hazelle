import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { THEMES, type Reading, type Theme } from '../ui';
import { probeRoot } from '../ui/probe';
import { lettersKey, READING } from './reading';
import { useReading } from './useReading';

vi.mock('../ui', async (original) => ({ ...(await original<typeof import('../ui')>()), readingDefault: (): Reading => ({ font: 'serif', size: 17, leading: 'normal', width: 'normal', reply: 'follow' }) }));

afterEach(() => vi.unstubAllGlobals());

it('keeps a theme\'s letters and the changes made in it apart from 기본\'s, and 응답 수신 시 as one', async () => {
  const kept = new Map<string, string>([[READING, JSON.stringify({ font: 'hahmlet', size: 19, leading: 'wide', width: 'narrow', reply: 'follow' })]]);
  const root = probeRoot();
  vi.stubGlobal('localStorage', { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) });
  let now: ReturnType<typeof useReading>;
  function Probe({ theme }: { theme: Theme }) {
    now = useReading(theme);
    return null;
  }
  const wear = (theme: Theme) => act(async () => root.render(<Probe theme={theme} />));
  const own = { font: 'hahmlet', size: 19, leading: 'wide', width: 'narrow', reply: 'follow' };
  await wear(THEMES.base);
  expect(now!.reading).toEqual(own);
  await wear(THEMES.discord);
  expect(now!.reading).toEqual({ ...THEMES.discord.letters, reply: 'follow' });
  await act(async () => now!.setReading({ ...now!.reading, size: 16, reply: 'stay' }));
  expect(now!.reading).toEqual({ ...THEMES.discord.letters, size: 16, reply: 'stay' });
  expect(JSON.parse(kept.get(lettersKey(THEMES.discord))!)).toEqual({ ...THEMES.discord.letters, size: 16 });
  await wear(THEMES.base);
  expect(now!.reading).toEqual({ ...own, reply: 'stay' });
  expect(now!.lettersIn(THEMES.discord).size).toBe(16);
  expect(now!.first).toEqual({ font: 'serif', size: 17, leading: 'normal', width: 'normal' });
  await wear(THEMES.discord);
  expect(now!.reading.size).toBe(16);
  expect(now!.first).toEqual(THEMES.discord.letters);
  await act(async () => root.unmount());
});
