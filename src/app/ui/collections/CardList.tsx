import { createContext, useContext, type ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import { MenuSlot, useMenuSlot } from '../overlays/MoreMenu';
import { cardDrag, useCardDrop } from './cardDrag';
import { FolderMark } from './FolderMark';
import { Item } from './Item';
import styles from './CardList.module.css';

const Folded = createContext(false);

export function CardList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {children}
    </ul>
  );
}

type Props = {
  // Folder opens as a destination and drop target; reserve › for unfolding prompt copies, not folders.
  folder?: boolean;
  title: string;
  badge?: string;
  tags?: string[];
  description?: string;
  note?: string;
  control?: ReactNode;
  // Under the card's button, such as a gauge; a press on it opens nothing.
  detail?: ReactNode;
  // The item open under or beside the cards (ListDetail).
  current?: boolean;
  onClick: () => void;
  // Things folded under this one, such as its copies: rows inside the card, not cards of their own.
  children?: ReactNode;
  // One of a pick of several; absent while not picking.
  selected?: boolean;
  // The card can be dragged onto a folder, carrying this key.
  drag?: string;
  // A dragged card's key, let go over this one (a folder).
  onDropCard?: (key: string) => void;
};

export function CardItem({ folder = false, title, badge, tags = [], description, note, control, detail, current, onClick, children, selected, drag, onDropCard }: Props) {
  const folded = useContext(Folded);
  const drop = useCardDrop(onDropCard);
  const slot = useMenuSlot();
  const meta =
    badge || tags.length > 0 ? (
      <>
        {badge && <Tag tone="accent">{badge}</Tag>}
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </>
    ) : undefined;
  return (
    <li className={[folded ? undefined : styles.card, folder && styles.folder, drop.over && styles.dropping].filter(Boolean).join(' ') || undefined} {...(drag === undefined ? {} : cardDrag(drag))} {...drop.props}>
      <div className={styles.head} onContextMenu={slot.onContextMenu}>
        <Item density="regular" scheme="list" leading={folder && <FolderMark size="md" />} title={title} meta={meta} preview={[description, note].filter(Boolean).join(' · ') || undefined} current={current} pressed={selected} onClick={onClick} />
        {control && (
          <span className={styles.control}>
            <MenuSlot value={slot.held}>{control}</MenuSlot>
          </span>
        )}
      </div>
      {detail && <div className={styles.detail}>{detail}</div>}
      {children && (
        <Folded value>
          <ul className={styles.folded}>{children}</ul>
        </Folded>
      )}
    </li>
  );
}
