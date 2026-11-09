import type { MouseEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { pressKeepsField } from './SendButton';

it('leaves the focus in the field through a press, sending first and then giving it back', () => {
  const order: string[] = [];
  const field = { current: { focus: () => order.push('focus') } as unknown as HTMLTextAreaElement };
  const press = pressKeepsField(field, () => order.push('send'));
  const down = { preventDefault: vi.fn() };
  press.onMouseDown(down as unknown as MouseEvent);
  expect(down.preventDefault).toHaveBeenCalled();
  press.onClick();
  expect(order).toEqual(['send', 'focus']);
});
