import { expect, it, vi } from 'vitest';
import { leaves } from './leave';

const part = (scrollTop = 0) => ({ scrollTop, removeAttribute: vi.fn(), getAnimations: (): { finished: Promise<unknown> }[] => [] });

function leaving({ connected, parentConnected = true, finish = Promise.resolve() }: { connected: boolean; parentConnected?: boolean; finish?: Promise<unknown> }) {
  const inner = part(7);
  const parent = { isConnected: parentConnected, appendChild: vi.fn(() => ((element.scrollTop = 0), (inner.scrollTop = 0))) };
  const element = Object.assign(part(40), { parentNode: parent, isConnected: connected, querySelectorAll: () => [inner], children: [inner], dataset: {} as DOMStringMap, getAnimations: () => [{ finished: finish }], remove: vi.fn(), inert: false });
  return { element, inner, parent, left: leaves(element as unknown as HTMLElement) };
}

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await Promise.resolve();
};

it('puts the element back where it stood, inert, marked leaving, scrolled as it was and without its ids, until its leaving ends', async () => {
  let finish = () => {};
  const { element, inner, parent, left } = leaving({ connected: false, finish: new Promise<void>((resolve) => (finish = resolve)) });
  left();
  await settled();
  expect(parent.appendChild).toHaveBeenCalledWith(element);
  expect(element.inert).toBe(true);
  expect(element.dataset.leaving).toBe('');
  expect(element.scrollTop).toBe(40);
  expect(inner.scrollTop).toBe(7);
  expect(inner.removeAttribute).toHaveBeenCalledWith('id');
  expect(element.remove).not.toHaveBeenCalled();
  finish();
  await settled();
  expect(element.remove).toHaveBeenCalled();
});

it("puts nothing back for StrictMode's rehearsal, or where the parent went too", async () => {
  for (const each of [leaving({ connected: true }), leaving({ connected: false, parentConnected: false })]) {
    each.left();
    await settled();
    expect(each.parent.appendChild).not.toHaveBeenCalled();
  }
});

it('takes the element away even when its leaving is cancelled', async () => {
  const { element, left } = leaving({ connected: false, finish: Promise.reject(new Error('cancelled')) });
  left();
  await settled();
  expect(element.remove).toHaveBeenCalled();
});
