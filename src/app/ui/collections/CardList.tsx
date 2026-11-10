import { ChevronRight } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { cardDrag, useCardDrop } from './cardDrag';
import { FolderMark } from './FolderMark';
import { Item } from './Item';
import { RowControl } from './RowControl';
import styles from './CardList.module.css';
import { classNames } from '../foundation/classNames';

const Folded = createContext(false);
const Places = createContext(false);

// places: each card opens a page or the pane beside it, and a › says so.
export function CardList({ label, places = false, children }: { label: string; places?: boolean; children: ReactNode }) {
  return (
    <ul className={styles.list} aria-label={label}>
      <Places value={places}>{children}</Places>
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
  // Not while picking, when a press picks; nor on a folder, which is not opened as a page.
  const opens = useContext(Places) && selected === undefined && !folder;
  const drop = useCardDrop(onDropCard);
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
    <li className={classNames(folded ? undefined : styles.card, folder && styles.folder, current && styles.current, drop.over && styles.dropping) || undefined} {...(drag === undefined ? {} : cardDrag(drag))} {...drop.props}>
      <RowControl control={control}>
        <Item density="regular" scheme="list" leading={folder && <FolderMark size="md" />} title={title} meta={meta} preview={[description, note].filter(Boolean).join(' · ') || undefined} trailing={opens && <Icon icon={ChevronRight} />} current={current} pressed={selected} onClick={onClick} />
      </RowControl>
      {detail && <div className={styles.detail}>{detail}</div>}
      {children && (
        <Folded value>
          <ul className={styles.folded}>{children}</ul>
        </Folded>
      )}
    </li>
  );
}
