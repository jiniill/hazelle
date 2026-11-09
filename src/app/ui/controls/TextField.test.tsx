import { act, type ReactElement, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from '../probe';
import { TextField } from './TextField';

type Field = { autoFocus: boolean; onFocus?: (event: { currentTarget: { select: () => void } }) => void };

function fieldIn(node: ReactNode): Field | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) return node.map(fieldIn).find(Boolean) ?? null;
  const { type, props } = node as ReactElement<{ children?: ReactNode } & Field>;
  return type === 'input' ? props : fieldIn(props.children);
}

it('selects the whole text as it takes the focus only when asked to', () => {
  const root = probeRoot();
  const shown: Record<string, Field | null> = {};
  function Probe() {
    shown.select = fieldIn(TextField({ label: '이름', value: '새 캐릭터', onChange: () => {}, focus: 'select' }));
    shown.caret = fieldIn(TextField({ label: '이름', value: '새 캐릭터', onChange: () => {}, focus: true }));
    return null;
  }
  act(() => root.render(<Probe />));
  const select = vi.fn();
  expect(shown.select!.autoFocus).toBe(true);
  shown.select!.onFocus!({ currentTarget: { select } });
  expect(select).toHaveBeenCalledOnce();
  expect(shown.caret).toMatchObject({ autoFocus: true, onFocus: undefined });
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
