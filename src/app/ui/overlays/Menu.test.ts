import type { KeyboardEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { moveByKey } from './Menu';

it("moves the focus through a menu's own items by ↑ ↓ Home End, round its ends, and leaves a field's keys to it", () => {
  const panel = {} as HTMLElement;
  const inner = {} as HTMLElement;
  const item = (name: string, menu = panel) => ({ name, closest: () => menu, focus: () => vi.stubGlobal('document', { activeElement: items[name] }) });
  const items: Record<string, ReturnType<typeof item>> = {};
  for (const name of ['first', 'second', 'third']) items[name] = item(name);
  const nested = item('nested', inner);
  Object.assign(panel, { querySelectorAll: () => [items.first, nested, items.second, items.third] });
  const press = (key: string, target = { matches: () => false }) => {
    const event = { key, target, defaultPrevented: false, preventDefault: vi.fn() };
    moveByKey(panel, event as unknown as KeyboardEvent);
    return event.preventDefault;
  };
  const at = () => (document.activeElement as unknown as { name: string }).name;
  try {
    vi.stubGlobal('document', { activeElement: null });
    press('ArrowDown');
    expect(at()).toBe('first');
    press('ArrowDown');
    expect(at()).toBe('second');
    press('End');
    expect(at()).toBe('third');
    press('ArrowDown');
    expect(at()).toBe('first');
    press('ArrowUp');
    expect(at()).toBe('third');
    press('Home');
    expect(at()).toBe('first');
    expect(press('ArrowDown', { matches: () => true })).not.toHaveBeenCalled();
    expect(at()).toBe('first');
    expect(press('a')).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
