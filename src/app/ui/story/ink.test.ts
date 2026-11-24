import { expect, it, vi } from 'vitest';
import { drawnInk, inkOn, settled, startInk, stepInk, WIDTH, type Ink } from './ink';

const pace = { follow: 450, even: 200, idle: 250, close: 350 };
const FRAME = 16;

it('starts solid at the length the story has when its writing begins', () => {
  const ink = startInk(120, 0);
  expect(settled(ink)).toBe(true);
  expect(stepInk(ink, FRAME, FRAME, pace)).toMatchObject({ edge: 120, solid: 120 });
});

it('never takes back what it has shown, however the text arrives', () => {
  let ink = startInk(0, 0);
  let length = 0;
  let seed = 3;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let now = FRAME; now < 20_000; now += FRAME) {
    if (random() < 0.05) ink = drawnInk(ink, (length += Math.floor(random() * 160)), now);
    const next: Ink = stepInk(ink, FRAME, now, pace);
    expect(next.edge).toBeGreaterThanOrEqual(ink.edge);
    expect(next.solid).toBeGreaterThanOrEqual(ink.solid);
    expect(next.edge).toBeLessThanOrEqual(length);
    expect(next.solid).toBeLessThanOrEqual(next.edge);
    expect(next.edge - next.solid).toBeLessThanOrEqual(WIDTH);
    ink = next;
  }
});

it('moves neither mark back on a frame stamped before its run was asked for', () => {
  const ink = drawnInk(startInk(0, 100), 200, 100);
  expect(stepInk(ink, -60, 40, pace)).toMatchObject({ edge: 0, solid: 0 });
});

it('closes on the end once nothing more comes, and waits on its gradient while more does', () => {
  let ink = drawnInk(startInk(0, 0), 200, 0);
  for (let now = FRAME; now <= 200; now += FRAME) ink = stepInk(ink, FRAME, now, pace);
  expect(ink.solid).toBe(Math.max(0, ink.edge - WIDTH));
  for (let now = 200 + FRAME; now < 5000; now += FRAME) ink = stepInk(ink, FRAME, now, pace);
  expect(settled(ink)).toBe(true);
});

it('stays inside a text that got shorter', () => {
  const ink = drawnInk({ ...startInk(0, 0), length: 300, edge: 250, solid: 220 }, 230, 10);
  expect(ink).toMatchObject({ length: 230, edge: 230, solid: 220 });
});

// One story of one text node on a page of stubs. setStart: what laying a range does.
function story(setStart: () => void = () => {}) {
  const frames = new Map<number, FrameRequestCallback>();
  const text = { data: '', parentElement: { localName: 'p' }, parentNode: null as unknown };
  const shadow = { adoptedStyleSheets: [], children: [] };
  text.parentNode = shadow;
  vi.stubGlobal('requestAnimationFrame', (tick: FrameRequestCallback) => frames.set(frames.size + 1, tick).size);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('getComputedStyle', () => ({ color: 'rgb(0, 0, 0)', getPropertyValue: () => '100ms' }));
  vi.stubGlobal('CSSStyleSheet', class { replaceSync() {} });
  vi.stubGlobal('Highlight', Set);
  vi.stubGlobal('CSS', { highlights: new Map() });
  vi.stubGlobal('Range', class { setStart = setStart; setEnd() {} });
  vi.stubGlobal('Element', class {});
  vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
  vi.stubGlobal('document', { createTreeWalker: () => { const left = [text]; return { nextNode: () => left.shift() ?? null }; } });
  const host = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
  return { frames, text, host, ink: inkOn(host as unknown as HTMLElement, shadow as unknown as ShadowRoot, true) };
}

it('asks for no frame once a text rewritten whole is no longer written', () => {
  const { frames, text, ink } = story();
  text.data = '가나다라마바사';
  ink.drawn(true);
  frames.get(1)!(performance.now() + 50);
  expect(frames.size).toBe(2);
  text.data = '다시 쓴 글';
  ink.drawn(true);
  ink.drawn(false);
  frames.delete(1);
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
});

it('ends for a story whose text a range no longer fits: the draw does not throw, the text stands whole and the error is told', () => {
  const gone = new DOMException('offset is larger than the node', 'IndexSizeError');
  let cut = false;
  const { frames, text, host, ink } = story(() => {
    if (cut) throw gone;
  });
  const told = vi.fn();
  vi.stubGlobal('reportError', told);
  text.data = '가나다라마바사';
  ink.drawn(true);
  cut = true;
  text.data = '가나다라마바사 그리고 더';
  expect(() => ink.drawn(true)).not.toThrow();
  expect(told).toHaveBeenCalledExactlyOnceWith(gone);
  expect(host.removeAttribute).toHaveBeenLastCalledWith('data-ink');
  expect(frames.size).toBe(0);
  ink.drawn(true);
  expect(told).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
});
