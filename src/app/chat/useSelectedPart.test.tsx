import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import type { PartAt } from './useMessageEdit';
import { useSelectedPart } from './useSelectedPart';

vi.mock('../ui', async () => ({ ...(await import('../ui/foundation/keys')), storySelection: () => ({ pieces: ['비가'], end: { x: 0, top: 0, bottom: 0 }, before: '오늘은 ' }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const part: PartAt = { from: 1, to: 1, side: 'text', shown: { from: 1, to: 1 } };
const key = (key: string, more: object = {}) => ({ key, code: '', shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, keyCode: 0, defaultPrevented: false, target: null, preventDefault() {}, ...more });

it('edits a selected part with the key typed over it, removes it on Backspace, and leaves a chord or a composition alone', async () => {
  const on = { edit: vi.fn(), remove: vi.fn() };
  const story = { current: {} as HTMLDivElement };
  function Probe() {
    useSelectedPart(story, () => part, true, on);
    return null;
  }
  const root = probeRoot();
  const keys = new Set<(event: unknown) => void>();
  vi.stubGlobal('window', { ...window, addEventListener: (type: string, run: (event: unknown) => void) => type === 'keydown' && keys.add(run), removeEventListener: (_: string, run: (event: unknown) => void) => keys.delete(run) });
  vi.stubGlobal('document', { ...document, getSelection: () => ({ removeAllRanges() {} }) });
  for (const name of ['HTMLTextAreaElement', 'HTMLInputElement', 'HTMLElement']) vi.stubGlobal(name, class {});
  const press = (event: ReturnType<typeof key>) => [...keys].forEach((run) => run(event));
  try {
    await act(() => root.render(<Probe />));
    press(key('c', { ctrlKey: true }));
    press(key('ㄱ', { isComposing: true }));
    press(key('Shift'));
    press(key('네'));
    press(key('Backspace'));
    expect(on.edit.mock.calls).toEqual([[part, { before: '오늘은 ', key: '네' }]]);
    expect(on.remove.mock.calls).toEqual([[part]]);
  } finally {
    await act(() => root.unmount());
  }
});
