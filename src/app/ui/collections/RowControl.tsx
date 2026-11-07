import type { MouseEvent, ReactNode } from 'react';
import { MenuSlot, useMenuSlot } from '../overlays/MoreMenu';
import { cardDrag, useCardDrop } from './cardDrag';
import styles from './RowControl.module.css';

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
  // A right-click's own answer, over the control's menu: the one menu many rows share (ItemRow).
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
};

// The row alone when nothing stands beside it or acts on it.
export function RowControl({ control, corner = false, drag, onDropCard, onContextMenu, children }: Props) {
  const drop = useCardDrop(onDropCard);
  const slot = useMenuSlot();
  if (!control && drag === undefined && !onDropCard && !onContextMenu) return children;
  const classes = [corner ? styles.corner : styles.beside, drop.over && styles.dropping].filter(Boolean).join(' ');
  return (
    <div className={classes} {...(drag !== undefined && cardDrag(drag))} {...drop.props} onContextMenu={onContextMenu ?? slot.onContextMenu}>
      {children}
      {control && (
        <span className={styles.control}>
          <MenuSlot value={slot.held}>{control}</MenuSlot>
        </span>
      )}
    </div>
  );
}
