import type { MouseEvent, ReactNode } from 'react';
import type { MenuHandle } from '../overlays/Menu';
import { openAtPointer } from '../overlays/MoreMenu';
import { Item } from './Item';
import { RowControl } from './RowControl';
import styles from './ItemRow.module.css';

type Props = {
  avatar?: ReactNode;
  title: string;
  time: string;
  typing: boolean;
  preview: string;
  current?: boolean;
  // One of a pick of several; absent while not picking.
  selected?: boolean;
  // Beside the row, outside its button: a fold of the rows hung under it.
  control?: ReactNode;
  // The row can be dragged onto a folder row, carrying this key.
  drag?: string;
  // Right-click opens it at the pointer; onOpen tells the one menu many rows share which row asked.
  menu?: { handle: MenuHandle; onOpen: () => void };
  // A dragged row's key, let go over this one.
  onDropCard?: (key: string) => void;
  // event: its modifier keys pick several (Ctrl, Shift) where the list offers it.
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function ItemRow({ avatar, title, time, typing, preview, current = false, selected, control, drag, menu, onDropCard, onClick }: Props) {
  return (
    <RowControl control={control} drag={drag} onDropCard={onDropCard} onContextMenu={menu && ((event) => openAtPointer(menu.handle, event) && menu.onOpen())}>
      <Item
        density="regular"
        scheme="side"
        leading={avatar}
        title={title}
        meta={typing ? <span className={styles.typing}>생성 중</span> : time}
        preview={preview}
        current={current}
        pressed={selected}
        onClick={onClick}
      />
    </RowControl>
  );
}
