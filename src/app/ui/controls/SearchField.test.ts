import type { KeyboardEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { clearByEscape } from './SearchField';

const esc = () => {
  const event = { key: 'Escape', defaultPrevented: false, nativeEvent: { isComposing: false, keyCode: 27 }, preventDefault: vi.fn(() => (event.defaultPrevented = true)) };
  return event as unknown as KeyboardEvent<HTMLInputElement> & { preventDefault: ReturnType<typeof vi.fn> };
};

it('clears typed words on Esc and takes it, leaves an empty field’s Esc to the layer under it, and an Esc its caller took alone', () => {
  const onChange = vi.fn();
  const typed = esc();
  clearByEscape('검색어', onChange)(typed);
  expect(onChange).toHaveBeenCalledWith('');
  expect(typed.preventDefault).toHaveBeenCalled();

  onChange.mockClear();
  const empty = esc();
  clearByEscape('', onChange)(empty);
  expect(onChange).not.toHaveBeenCalled();
  expect(empty.preventDefault).not.toHaveBeenCalled();

  const closes = vi.fn((event: KeyboardEvent<HTMLInputElement>) => event.preventDefault());
  clearByEscape('검색어', onChange, closes)(esc());
  expect(closes).toHaveBeenCalled();
  expect(onChange).not.toHaveBeenCalled();
});
