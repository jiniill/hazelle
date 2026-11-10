import type { ReactNode } from 'react';
import type { MenuHandle } from '../overlays/Menu';
import { MenuSlot, openAtPointer, useMenuSlot } from '../overlays/MoreMenu';
import { cardDrag, useCardDrop } from './cardDrag';
import styles from './RowControl.module.css';
import { classNames } from '../foundation/classNames';

// Right-click opens it at the pointer; onOpen tells the one menu many rows share which row asked.
export type RowMenu = { handle: MenuHandle; onOpen: () => void };

type Props = {
  // Beside the row's button, outside it, since a button holds no control: a ⋯, or a fold of what hangs under the row.
  // A right-click on the row opens the control's menu where it holds one (MenuSlot).
  control?: ReactNode;
  // The control in the row's top end corner, over it, where the row is a card (LineageCard).
  corner?: boolean;
  // The row can be dragged onto a folder row, carrying this key.
  drag?: string;
  // A dragged row's key, let go over this one.
  onDropCard?: (key: string) => void;
  // A right-click's own answer, over the control's menu.
  menu?: RowMenu;
  children: ReactNode;
};

// The row alone when nothing stands beside it or acts on it.
export function RowControl({ control, corner = false, drag, onDropCard, menu, children }: Props) {
  const drop = useCardDrop(onDropCard);
  const slot = useMenuSlot();
  if (!control && drag === undefined && !onDropCard && !menu) return children;
  const classes = classNames(corner ? styles.corner : styles.beside, drop.over && styles.dropping);
  return (
    <div className={classes} {...(drag !== undefined && cardDrag(drag))} {...drop.props} onContextMenu={menu ? (event) => openAtPointer(menu.handle, event) && menu.onOpen() : slot.onContextMenu}>
      {children}
      {control && (
        <span className={styles.control}>
          <MenuSlot value={slot.held}>{control}</MenuSlot>
        </span>
      )}
    </div>
  );
}
