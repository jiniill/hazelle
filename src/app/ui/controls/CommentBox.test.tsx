import { act, type ReactElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { CommentBox } from './CommentBox';

type Area = { onKeyDown: (event: object) => void };

function areaIn(node: ReactNode): Area | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(areaIn).find(Boolean) ?? null;
  const { type, props } = node as ReactElement<{ children?: ReactNode } & Area>;
  return type === 'textarea' ? props : areaIn(props.children);
}

const press = (key: string, ctrlKey = false) => ({ key, code: key, shiftKey: false, ctrlKey, metaKey: false, altKey: false, nativeEvent: { isComposing: false, keyCode: 0 }, preventDefault: vi.fn() });

it('sends on the keys it is given and keeps them while it cannot send', () => {
  const root = probeRoot();
  const run = vi.fn();
  const shown: Record<string, Area | null> = {};
  function Probe() {
    const box = { label: '댓글', value: '안녕', onChange: () => {}, actions: null };
    shown.ready = areaIn(CommentBox({ ...box, send: { keys: [{ key: 'Enter', mod: true }], run } }));
    shown.closed = areaIn(CommentBox({ ...box, send: { keys: [{ key: 'Enter', mod: true }], run: null } }));
    return null;
  }
  act(() => root.render(<Probe />));
  const sent = press('Enter', true);
  shown.ready!.onKeyDown(sent);
  expect(run).toHaveBeenCalledOnce();
  expect(sent.preventDefault).toHaveBeenCalled();
  shown.ready!.onKeyDown(press('Enter'));
  const held = press('Enter', true);
  shown.closed!.onKeyDown(held);
  expect(held.preventDefault).toHaveBeenCalled();
  expect(run).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
