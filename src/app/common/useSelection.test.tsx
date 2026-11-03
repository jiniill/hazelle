import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useSelection } from './useSelection';

it('starts a pick with a toggle, picks every id given, and ends with no pick or bar', async () => {
  let selection: ReturnType<typeof useSelection>;
  function Probe() {
    selection = useSelection();
    return null;
  }
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe />));
    const bar = () => selection!.bar({ counted: (count) => `${count}개`, ask: '선택해 주세요' }, null);
    expect(bar()).toBeFalsy();
    await act(() => selection!.toggle('a'));
    await act(() => selection!.toggle('b'));
    await act(() => selection!.toggle('a'));
    expect([...selection!.picked!]).toEqual(['b']);
    expect(bar()).toBeTruthy();
    await act(() => selection!.all(['a', 'b', 'c']));
    expect([...selection!.picked!]).toEqual(['a', 'b', 'c']);
    await act(() => selection!.clear());
    expect(selection!.picked).toBeNull();
    expect(bar()).toBeFalsy();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('picks a Shift range from the thing last toggled, adding to the pick, the anchor kept', async () => {
  let selection: ReturnType<typeof useSelection>;
  function Probe() {
    selection = useSelection();
    return null;
  }
  const root = probeRoot();
  const order = ['a', 'b', 'c', 'd', 'e'];
  try {
    await act(() => root.render(<Probe />));
    await act(() => selection!.toggle('d'));
    await act(() => selection!.range('b', order));
    expect([...selection!.picked!].sort()).toEqual(['b', 'c', 'd']);
    await act(() => selection!.range('e', order));
    expect([...selection!.picked!].sort()).toEqual(['b', 'c', 'd', 'e']);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
