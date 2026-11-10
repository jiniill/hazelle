import type { MouseEvent, ReactNode } from 'react';
import { Item } from './Item';
import { RowControl, type RowMenu } from './RowControl';
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
  menu?: RowMenu;
  // A dragged row's key, let go over this one.
  onDropCard?: (key: string) => void;
  // event: its modifier keys pick several (Ctrl, Shift) where the list offers it.
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
};

export function ItemRow({ avatar, title, time, typing, preview, current = false, selected, control, drag, menu, onDropCard, onClick }: Props) {
  return (
    <RowControl control={control} drag={drag} onDropCard={onDropCard} menu={menu}>
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
