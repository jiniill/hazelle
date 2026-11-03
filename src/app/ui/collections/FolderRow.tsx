import type { ReactNode } from 'react';
import { MenuSlot, useMenuSlot } from '../overlays/MoreMenu';
import { useCardDrop } from './cardDrag';
import { Item } from './Item';
import styles from './FolderRow.module.css';

// menu: its ⋯ beside the row, also opened by a right-click. onDropCard: a dragged row's key, let go over it.
type Props = { name: string; count: number; open: boolean; onToggle: () => void; menu?: ReactNode; onDropCard?: (key: string) => void };

export function FolderRow({ name, count, open, onToggle, menu, onDropCard }: Props) {
  const drop = useCardDrop(onDropCard);
  const slot = useMenuSlot();
  const row = <Item density="compact" scheme="side" title={name} meta={count} expanded={open} onClick={onToggle} />;
  if (!menu && !onDropCard) return row;
  return (
    <div className={[styles.head, drop.over && styles.dropping].filter(Boolean).join(' ')} onContextMenu={slot.onContextMenu} {...drop.props}>
      {row}
      {menu && (
        <span className={styles.control}>
          <MenuSlot value={slot.held}>{menu}</MenuSlot>
        </span>
      )}
    </div>
  );
}

export function TreeRow({ depth, children }: { depth: number; children: ReactNode }) {
  let row = children;
  for (let i = 0; i < depth; i++) row = <div className={styles.folderItems}>{row}</div>;
  return row;
}
