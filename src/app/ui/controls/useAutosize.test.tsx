import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { useAutosize } from './useAutosize';

it('measures a new element put in the area\'s place, its text unchanged', async () => {
  const root = probeRoot();
  vi.stubGlobal('getComputedStyle', () => ({ borderTopWidth: '1px', borderBottomWidth: '1px' }));
  const element = (scrollHeight: number) => {
    const set = new Map<string, string>();
    return { scrollHeight, set, style: { height: '', setProperty: (name: string, value: string) => void set.set(name, value) } };
  };
  const [first, second] = [element(40), element(80)];
  const area = { current: first as unknown as HTMLTextAreaElement };
  function Probe({ mounted }: { mounted: string }) {
    useAutosize(area, '같은 글', mounted);
    return null;
  }
  try {
    await act(async () => root.render(<Probe mounted="box" />));
    expect(first.set.get('--autosize')).toBe('42px');
    area.current = second as unknown as HTMLTextAreaElement;
    await act(async () => root.render(<Probe mounted="bar" />));
    expect(second.set.get('--autosize')).toBe('82px');
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});
