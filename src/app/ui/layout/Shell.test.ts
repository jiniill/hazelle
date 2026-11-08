import { act, createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { useHeldScroll } from './Shell';

afterEach(() => vi.unstubAllGlobals());

it('puts the page held under a layer back where it was read, through the layer and after it closes', async () => {
  const root = probeRoot();
  const view = window as unknown as { scrollY: number; scrollTo: (x: number, y: number) => void };
  view.scrollY = 600;
  view.scrollTo = (_x, y) => {
    view.scrollY = y;
  };
  function Probe({ held }: { held: boolean }) {
    useHeldScroll(held);
    return null;
  }
  await act(async () => root.render(createElement(Probe, { held: false })));
  // Each navigation (opening the layer, walking it, closing it) scrolls to the top first.
  for (const held of [true, true, false]) {
    view.scrollY = 0;
    await act(async () => root.render(createElement(Probe, { held })));
    expect(view.scrollY).toBe(600);
  }
  await act(async () => root.unmount());
});
