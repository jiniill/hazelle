import type { KeyboardEvent } from 'react';
import { expect, it, vi } from 'vitest';
import { openingField } from './layers';
import { firstStop, moveByKey } from './Menu';

it("moves the focus through a menu's own items by ↑ ↓ Home End, round its ends, leaves a field's keys to it, and steps by ↑ ↓ from a search to the rows beside it", () => {
  const panel = {} as HTMLElement;
  const inner = {} as HTMLElement;
  const item = (name: string, menu = panel) => ({ name, closest: () => menu, focus: () => vi.stubGlobal('document', { activeElement: items[name] }) });
  const items: Record<string, ReturnType<typeof item>> = {};
  for (const name of ['first', 'second', 'third']) items[name] = item(name);
  const nested = item('nested', inner);
  Object.assign(panel, { querySelectorAll: () => [items.first, nested, items.second, items.third] });
  // before: the items that stand before it in the menu.
  const tag = (name: string, before: unknown[] = []) => ({ matches: (selector: string) => selector.split(', ').includes(name), compareDocumentPosition: (item: unknown) => (before.includes(item) ? 2 : 4) });
  const press = (key: string, target = tag('button'), isComposing = false) => {
    const event = { key, target, defaultPrevented: false, preventDefault: vi.fn(), nativeEvent: { isComposing, keyCode: 0 } };
    moveByKey(panel, event as unknown as KeyboardEvent);
    return event.preventDefault;
  };
  const at = () => (document.activeElement as unknown as { name: string }).name;
  try {
    vi.stubGlobal('Node', { DOCUMENT_POSITION_PRECEDING: 2 });
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
    expect(press('ArrowDown', tag('textarea'))).not.toHaveBeenCalled();
    expect(at()).toBe('first');
    const search = { ...tag('', [items.first]), matches: (selector: string) => selector === 'input, textarea' };
    expect(press('End', search)).not.toHaveBeenCalled();
    expect(press('ArrowDown', search, true)).not.toHaveBeenCalled();
    vi.stubGlobal('document', { activeElement: search });
    press('ArrowDown', search);
    expect(at()).toBe('second');
    vi.stubGlobal('document', { activeElement: search });
    press('ArrowUp', search);
    expect(at()).toBe('first');
    expect(press('a')).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('opens a menu of rows on the search over them, else on the one picked, else on its first row, and a form on its first control', () => {
  const field = openingField(true);
  const picked = '[role="menuitemradio"][aria-checked="true"]:not(:disabled)';
  const panel = (found: Record<string, string>) => ({ querySelector: (selector: string) => found[selector] ?? null }) as unknown as ParentNode;
  const all = { [field]: 'search', [picked]: 'picked', button: 'door', [`${field}, [role^="menuitem"], button`]: 'door' };
  expect(firstStop(panel(all), 'menu', true)).toBe('search');
  expect(firstStop(panel(all), 'dialog', true)).toBe('door');
  expect(firstStop(panel({ [picked]: 'picked', button: 'door' }), 'menu', true)).toBe('picked');
  expect(firstStop(panel({ button: 'door' }), 'menu', true)).toBe('door');
});
