import { act, useRef } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { backLayers, openingField, openingStop, useFocusTrap, useLayer } from './layers';

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

it('lets a back leave a step while Esc goes to the layer under it, and keeps a layer that cannot close through both', async () => {
  const root = probeRoot();
  const keys: ((event: object) => void)[] = [];
  Object.assign(document, { addEventListener: (type: string, listener: (event: object) => void) => type === 'keydown' && keys.push(listener) });
  const esc = () => keys.at(-1)!({ key: 'Escape', defaultPrevented: false, isComposing: false, keyCode: 27, preventDefault() {} });
  const closed: string[] = [];
  const asked = vi.fn();
  const stop = backLayers.subscribe(asked);
  function Probe({ closes }: { closes: boolean }) {
    useLayer(true, { outside: () => false, close: closes ? () => void closed.push('panel') : undefined, takesBack: true });
    useLayer(true, { outside: () => false, close: () => void closed.push('part'), takesBack: true, step: '프롬프트' });
    return null;
  }
  try {
    await act(async () => root.render(<Probe closes />));
    esc();
    backLayers.closeAbove(1);
    expect(closed).toEqual(['panel', 'part']);

    await act(async () => root.render(<Probe closes={false} />));
    closed.length = 0;
    asked.mockClear();
    esc();
    backLayers.closeAbove(0);
    expect(closed).toEqual(['part']);
    expect(asked).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  } finally {
    stop();
    vi.unstubAllGlobals();
  }
});

it('opens a trap by the opening rule, takes the focus back in when its control goes but not after a press on its text, and gives it back only from the body', async () => {
  const root = probeRoot();
  let watched = () => {};
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        watched = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  type Control = { name: string; isConnected: boolean; matches: () => boolean; focus: () => void };
  let focusin: (event: { target: unknown }) => void = () => {};
  const control = (name: string): Control => ({
    name,
    isConnected: true,
    matches: () => false,
    focus() {
      Object.assign(document, { activeElement: this });
      focusin({ target: this });
    },
  });
  const body = { name: 'body' };
  const opener = control('opener');
  let field = control('field');
  const box = {
    hasAttribute: () => false,
    contains: (node: unknown) => node === field,
    querySelector: (selector: string) => (selector.startsWith('input') ? field : null),
    addEventListener: (_type: string, listener: typeof focusin) => (focusin = listener),
    removeEventListener() {},
  };
  const at = () => (document.activeElement as unknown as { name: string }).name;
  const drop = () => Object.assign(document, { activeElement: body });
  function Probe({ open }: { open: boolean }) {
    useFocusTrap(useRef(box as unknown as HTMLElement), open);
    return null;
  }
  try {
    Object.assign(document, { body, activeElement: opener });
    await act(async () => root.render(<Probe open />));
    expect(at()).toBe('field');
    // A press on the box's text: the field still stands.
    drop();
    watched();
    expect(at()).toBe('body');
    // A step changed in place (a wrong password): the field goes and another stands in its place.
    field.focus();
    field.isConnected = false;
    field = control('again');
    drop();
    watched();
    expect(at()).toBe('again');
    // Closed with the focus gone on to a control outside: it stays there.
    Object.assign(document, { activeElement: control('outside') });
    await act(async () => root.render(<Probe open={false} />));
    expect(at()).toBe('outside');
    // Closed with the focus on the body: it goes back to the opener.
    Object.assign(document, { activeElement: opener });
    await act(async () => root.render(<Probe open />));
    drop();
    await act(async () => root.render(<Probe open={false} />));
    expect(at()).toBe('opener');
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});
