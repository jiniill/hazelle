import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { backLayers, openingField, openingStop, useLayer } from './layers';

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

it('opens on a marked control, else a place to type before the head\'s ×, and on a search only under a mouse', () => {
  const box = (found: Record<string, string>) => ({ querySelector: (selector: string) => found[selector] ?? null }) as unknown as ParentNode;
  const field = openingField(true);
  expect(openingStop(box({ '[data-autofocus]': 'editor', [field]: 'name', button: '×' }), true)).toBe('editor');
  expect(openingStop(box({ [field]: 'name', button: '×' }), true)).toBe('name');
  expect(openingStop(box({ button: '×' }), true)).toBe('×');
  expect(openingStop(box({ [field]: 'search', button: '×' }), false)).toBe('×');
  expect(openingField(false)).toContain('[type="search"]');
});
