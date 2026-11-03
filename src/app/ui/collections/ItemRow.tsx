import type { ReactNode } from 'react';
import type { MenuHandle } from '../overlays/Menu';
import { openAtPointer } from '../overlays/MoreMenu';
import { cardDrag } from './cardDrag';
import { Item } from './Item';
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
  // The row can be dragged onto a folder row, carrying this key.
  drag?: string;
  // Right-click opens it at the pointer; onOpen tells the one menu many rows share which row asked.
  menu?: { handle: MenuHandle; onOpen: () => void };
  onClick: () => void;
};

export function ItemRow({ avatar, title, time, typing, preview, current = false, selected, drag, menu, onClick }: Props) {
  const row = (
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
  );
  if (drag === undefined && !menu) return row;
  return (
    <div {...(drag !== undefined && cardDrag(drag))} onContextMenu={menu && ((event) => openAtPointer(menu.handle, event) && menu.onOpen())}>
      {row}
    </div>
  );
}
