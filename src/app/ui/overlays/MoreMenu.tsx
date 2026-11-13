import { MoreHorizontal, type LucideIcon } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import { hasFinePointer } from '../foundation/media';
import { Menu, useMenuHandle, type MenuHandle } from './Menu';

// Use whole-item actions here. dot marks pending attention; handle supports a second opener;
// place chooses the roomier story side for message tools. sign: its button's, ⋯ unless the menu leads what it is of.
export function MoreMenu({ of, dot, handle, kind, size, sign = MoreHorizontal, place = 'below-end', children }: { of: string; dot?: boolean; handle?: MenuHandle; kind?: 'menu' | 'dialog'; size?: 'md' | 'form'; sign?: LucideIcon; place?: 'below-end' | 'end' | 'above-end' | 'above-start'; children: ReactNode }) {
  const own = useMenuHandle();
  const menu = handle ?? own;
  const slot = useContext(MenuSlot);
  useEffect(() => {
    if (!slot) return;
    slot.current = menu;
    return () => {
      slot.current = null;
    };
  }, [slot, menu]);
  const label = `${of} 메뉴`;
  return (
    <Menu kind={kind} size={size} place={place} label={label} handle={menu} trigger={(opener) => <IconButton icon={sign} label={label} size="sm" dot={dot} {...opener} />}>
      {children}
    </Menu>
  );
}

// Right-click opens menus on kit cards/folders/rows only. Preserve browser context menus for messages,
// fields and touch long-presses so copy/spelling remains available.
export const MenuSlot = createContext<RefObject<MenuHandle | null> | null>(null);

export function useMenuSlot() {
  const held = useRef<MenuHandle | null>(null);
  const onContextMenu = (event: MouseEvent) => void openAtPointer(held.current, event);
  return { held, onContextMenu };
}

// false: the browser's own menu shows instead.
export function openAtPointer(menu: MenuHandle | null, event: MouseEvent): boolean {
  // Already open, the right-click fell inside it (a press outside closed it first): the browser's.
  if (!menu || menu.read().open || !hasFinePointer()) return false;
  event.preventDefault();
  menu.set({ open: true, from: null, at: { x: event.clientX, y: event.clientY } });
  return true;
}
