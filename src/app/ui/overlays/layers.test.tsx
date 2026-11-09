import { act, StrictMode, useRef, type FragmentInstance } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { backLayers, openingField, openingFocus, openingStop, useAnchored, useFocusReturn, useFocusTrap, useLayer } from './layers';

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

it("takes the focus into a fragment by the opening rule, among the page's fields only those inside it", () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('Node', { DOCUMENT_POSITION_CONTAINED_BY: 16 });
  const focused: string[] = [];
  const element = (name: string) => ({ name, focus: () => focused.push(name) });
  const outside = element('outside');
  const page: Record<string, ReturnType<typeof element>[]> = { [openingField(true)]: [outside, element('name'), element('text')], button: [element('remove')] };
  vi.stubGlobal('document', { querySelectorAll: (selector: string) => page[selector] ?? [] });
  const fragment = { compareDocumentPosition: (node: unknown) => (node === outside ? 2 : 16) } as unknown as FragmentInstance;
  try {
    openingFocus(fragment);
    openingFocus(null);
    expect(focused).toEqual(['name']);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('gives the focus back as what was open in place closes with it, to its button or else its opener, never over a moved focus', async () => {
  const root = probeRoot();
  const element = () => ({ isConnected: true, focus: vi.fn() }) as unknown as HTMLElement & { focus: ReturnType<typeof vi.fn> };
  const focus = (node: unknown) => Object.assign(document, { activeElement: node });
  let back: HTMLElement | null = null;
  function Probe({ open }: { open: boolean }) {
    useFocusReturn(open, () => back);
    return null;
  }
  const opener = element();
  const button = element();
  try {
    await act(async () => root.render(<Probe open={false} />));
    focus(opener);
    await act(async () => root.render(<Probe open />));
    focus(null);
    await act(async () => root.render(<Probe open={false} />));
    expect(opener.focus).toHaveBeenCalledOnce();

    back = button;
    await act(async () => root.render(<Probe open />));
    focus(null);
    await act(async () => root.render(<Probe open={false} />));
    expect(button.focus).toHaveBeenCalledOnce();

    await act(async () => root.render(<Probe open />));
    focus(element());
    await act(async () => root.render(<Probe open={false} />));
    expect(button.focus).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('gives one that replaced another as it closed the focus back to the first one\'s opener', async () => {
  const root = probeRoot();
  const body = { name: 'body' };
  const opener = { name: 'opener', isConnected: true, focus: () => Object.assign(document, { activeElement: opener }) };
  const at = () => (document.activeElement as unknown as { name: string }).name;
  function First() {
    useFocusReturn(true);
    return null;
  }
  function Second({ open }: { open: boolean }) {
    useFocusReturn(open);
    return null;
  }
  try {
    Object.assign(document, { body, activeElement: opener });
    await act(async () => root.render(<First />));
    Object.assign(document, { activeElement: body });
    await act(async () => root.render(<Second open />));
    expect(at()).toBe('opener');
    Object.assign(document, { activeElement: body });
    await act(async () => root.render(<Second open={false} />));
    expect(at()).toBe('opener');
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});

it('opens a trap by the opening rule, takes the focus back in when its control goes but not after a press on its text, and gives it back only from the body, to what held it before', async () => {
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
    // Run twice as it opens (StrictMode): the second run finds the focus inside and keeps the opener.
    await act(async () => root.render(<StrictMode><Probe open /></StrictMode>));
    drop();
    await act(async () => root.render(<StrictMode><Probe open={false} /></StrictMode>));
    expect(at()).toBe('opener');
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});

it("flips a popover to the other side of its anchor where it would run past the window it was opened in, not only the screen", async () => {
  const root = probeRoot();
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible', getPropertyValue: () => '16' }));
  Object.assign(window, { innerHeight: 900 });
  Object.assign(document.documentElement, { clientWidth: 1440 });
  const rect = (top: number, bottom: number) => ({ top, bottom, left: 400, right: 640 });
  let box = rect(626, 886);
  let spot = rect(598, 616);
  const popover = { style: { setProperty() {} }, dataset: {} as DOMStringMap, parentElement: null, getBoundingClientRect: () => box };
  const anchor = (frame: ReturnType<typeof rect> | null) => ({ getBoundingClientRect: () => spot, closest: () => frame && { getBoundingClientRect: () => frame } });
  function Probe({ frame }: { frame: ReturnType<typeof rect> | null }) {
    useAnchored(true, useRef(popover as unknown as HTMLElement), useRef(anchor(frame) as unknown as HTMLElement), () => {});
    return null;
  }
  try {
    await act(async () => root.render(<Probe key="window" frame={rect(70, 830)} />));
    expect(popover.dataset.flipped).toBe('');
    await act(async () => root.render(<Probe key="page" frame={null} />));
    expect(popover.dataset.flipped).toBeUndefined();
    // Set above its anchor and running off the screen's top: it goes below.
    spot = rect(100, 118);
    box = rect(-200, 90);
    await act(async () => root.render(<Probe key="above" frame={null} />));
    expect(popover.dataset.flipped).toBe('');
    await act(async () => root.unmount());
  } finally {
    vi.unstubAllGlobals();
  }
});
