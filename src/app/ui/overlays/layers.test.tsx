import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { backLayers, useLayer } from './layers';

it('counts only a layer that takes back, and closes the newest as Esc does', async () => {
  const root = probeRoot();
  const closed: string[] = [];
  const close = (name: string) => (refocus: boolean) => void closed.push(`${name}:${refocus}`);
  function Probe() {
    useLayer(true, { outside: () => false, close: close('dialog'), takesBack: true });
    useLayer(true, { outside: () => false, close: close('menu'), takesBack: true });
    useLayer(true, { outside: () => false, close: close('peek') });
    return null;
  }
  try {
    await act(async () => root.render(<Probe />));
    expect(backLayers.count()).toBe(2);
    backLayers.closeAbove(1);
    expect(closed).toEqual(['menu:true']);
    await act(async () => root.unmount());
    expect(backLayers.count()).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
