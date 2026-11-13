import { Hash } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { useShape, type Shapes } from '../foundation/theme';
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

const WRITING = <span className={styles.typing}>생성 중</span>;

export function ItemRow({ avatar, title, time, typing, preview, current = false, selected, control, drag, menu, onDropCard, onClick }: Props) {
  return (
    <RowControl control={control} drag={drag} onDropCard={onDropCard} menu={menu}>
      <Item
        density="regular"
        scheme="side"
        leading={avatar}
        title={title}
        meta={typing ? WRITING : time}
        preview={preview}
        current={current}
        pressed={selected}
        onClick={onClick}
      />
    </RowControl>
  );
}

// sought: a search listed it, by its name or by what was said. place: where it is kept, said while a search lists chats
// out of their folders.
type ChatProps = Omit<Props, 'avatar'> & { sought: boolean; place?: string };

// A chat in its character's list, the region a theme's list shape draws. cards: its name and when, over a line of what
// was said. channels: its name alone after a #; when it was written is left out, and what was said shows only under a
// row a search found, which it may be what matched, with where the chat is kept at the row's end.
const CHAT_ROWS: Record<Shapes['list'], (props: ChatProps) => ReactNode> = {
  cards: ({ place, preview, ...row }) => <ItemRow {...row} preview={place ? `${place} · ${preview}` : preview} />,
  channels: ({ title, typing, preview, sought, place, current = false, selected, control, drag, menu, onDropCard, onClick }) => (
    <RowControl control={control} drag={drag} onDropCard={onDropCard} menu={menu}>
      <Item
        density="compact"
        scheme="side"
        leading={<Icon icon={Hash} size="sm" />}
        title={<span className={styles.line}>{title}</span>}
        meta={typing ? WRITING : place}
        preview={sought ? <span className={styles.line}>{preview}</span> : undefined}
        current={current}
        pressed={selected}
        onClick={onClick}
      />
    </RowControl>
  ),
};

export function ChatRow(props: ChatProps) {
  return CHAT_ROWS[useShape('list')](props);
}
