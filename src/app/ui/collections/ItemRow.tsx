import type { MouseEvent, ReactNode } from 'react';
import type { MenuHandle } from '../overlays/Menu';
import { openAtPointer } from '../overlays/MoreMenu';
import { cardDrag, useCardDrop } from './cardDrag';
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
  // A dragged row's key, let go over this one.
  onDropCard?: (key: string) => void;
  // event: its modifier keys pick several (Ctrl, Shift) where the list offers it.
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function ItemRow({ avatar, title, time, typing, preview, current = false, selected, drag, menu, onDropCard, onClick }: Props) {
  const drop = useCardDrop(onDropCard);
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
  if (drag === undefined && !menu && !onDropCard) return row;
  return (
    <div
      className={drop.over ? styles.dropping : undefined}
      {...(drag !== undefined && cardDrag(drag))}
      {...drop.props}
      onContextMenu={menu && ((event) => openAtPointer(menu.handle, event) && menu.onOpen())}
    >
      {row}
    </div>
  );
}
