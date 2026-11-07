import type { ReactNode } from 'react';
import { Item } from './Item';
import { RowControl } from './RowControl';
import styles from './FolderRow.module.css';

// menu: its ⋯ beside the row, also opened by a right-click. onDropCard: a dragged row's key, let go over it.
type Props = { name: string; count: number; open: boolean; onToggle: () => void; menu?: ReactNode; onDropCard?: (key: string) => void };

export function FolderRow({ name, count, open, onToggle, menu, onDropCard }: Props) {
  return (
    <RowControl control={menu} onDropCard={onDropCard}>
      <Item density="compact" scheme="side" title={name} meta={count} expanded={open} onClick={onToggle} />
    </RowControl>
  );
}

export function TreeRow({ depth, children }: { depth: number; children: ReactNode }) {
  let row = children;
  for (let i = 0; i < depth; i++) row = <div className={styles.folderItems}>{row}</div>;
  return row;
}
