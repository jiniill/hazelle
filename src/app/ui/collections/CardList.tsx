import { ChevronRight } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { Item } from './Item';
import styles from './CardList.module.css';
import { classNames } from '../foundation/classNames';

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
  title: string;
  badge?: string;
  tags?: string[];
  description?: string;
  note?: string;
  // Under the card's button, such as a gauge; a press on it opens nothing.
  detail?: ReactNode;
  // The item open under or beside the cards (ListDetail).
  current?: boolean;
  onClick: () => void;
};

export function CardItem({ title, badge, tags = [], description, note, detail, current, onClick }: Props) {
  const opens = useContext(Places);
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
    <li className={classNames(styles.card, current && styles.current)}>
      <Item density="regular" scheme="list" title={title} meta={meta} preview={[description, note].filter(Boolean).join(' · ') || undefined} trailing={opens && <Icon icon={ChevronRight} />} current={current} onClick={onClick} />
      {detail && <div className={styles.detail}>{detail}</div>}
    </li>
  );
}
