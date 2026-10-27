import { MoreHorizontal } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import { hasFinePointer } from '../foundation/media';
import { Menu, useMenuHandle, type MenuHandle } from './Menu';

// Use whole-item actions here. dot marks pending attention; handle supports a second opener;
// place chooses the roomier story side for message tools.
export function MoreMenu({ of, dot, handle, place = 'below-end', children }: { of: string; dot?: boolean; handle?: MenuHandle; place?: 'below-end' | 'end'; children: ReactNode }) {
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
    <Menu place={place} label={label} handle={menu} trigger={(opener) => <IconButton icon={MoreHorizontal} label={label} size="sm" dot={dot} {...opener} />}>
      {children}
    </Menu>
  );
}

// Right-click opens menus on kit cards/folders/rows only. Preserve browser context menus for messages,
// fields and touch long-presses so copy/spelling remains available.
export const MenuSlot = createContext<RefObject<MenuHandle | null> | null>(null);

export function useMenuSlot() {
  const held = useRef<MenuHandle | null>(null);
  const onContextMenu = (event: MouseEvent) => {
    const menu = held.current;
    // Already open, the right-click fell inside it (a press outside closed it first): the browser's.
    if (!menu || menu.read().open || !hasFinePointer()) return;
    event.preventDefault();
    menu.set({ open: true, from: null, at: { x: event.clientX, y: event.clientY } });
  };
  return { held, onContextMenu };
}
