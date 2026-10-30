import { ChevronRight } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { useSeekRow } from '../foundation/seek';
import { Tag } from '../foundation/Tag';
import { MenuSlot, useMenuSlot } from '../overlays/MoreMenu';
import { FolderMark } from './FolderMark';
import { Item } from './Item';
import { Viewport } from './Viewport';
import styles from './List.module.css';

// In the windowed form the Viewport's rows are the li, so an item renders none of its own.
const Windowed = createContext(false);
const Places = createContext(false);

// box: the rows in one box, as SettingGroup's are, for a list on a page or a short list a screen leads with. places:
// rows that go to another page (설정's pages, a character's parts, the kinds of connection), each with a ›; a list of
// the user's own things opens them beside it and takes none.
export function List(props: { label: string; box?: boolean; places?: boolean; children: ReactNode } | { label: string; keys: readonly string[]; box?: boolean; children: (index: number) => ReactNode }) {
  if ('keys' in props) {
    const rows = (
      <Windowed value>
        <Viewport keys={props.keys} variant="items" list={props.label}>
          {props.children}
        </Viewport>
      </Windowed>
    );
    return props.box ? <div className={styles.box}>{rows}</div> : rows;
  }
  return (
    <Places value={props.places ?? false}>
      <ul className={props.box ? `${styles.list} ${styles.box}` : styles.list} aria-label={props.label}>
        {props.children}
      </ul>
    </Places>
  );
}

type ItemProps = {
  leading?: ReactNode;
  // A folder among the things: its mark in leading's place, and a › at the end where it opens as a place; one that
  // folds in place (expanded) takes none.
  folder?: boolean;
  title: string;
  badge?: string;
  code?: string;
  description?: string;
  tags?: string[];
  // Quiet words at the row's end: where it is used (an unused thing says nothing), when, how much.
  note?: string;
  trailing?: ReactNode;
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
  control?: ReactNode;
  detail?: ReactNode;
  children?: ReactNode;
  // pressed: one of a set of choices. current: the item open beside the list (ListDetail). expanded: the row opens
  // its detail in place.
  selected?: boolean;
  current?: boolean;
  expanded?: boolean;
  // muted: a row standing in for a thing gone, such as a deleted post kept over its comments.
  tone?: 'plain' | 'muted';
};

export function ListItem({ leading, folder = false, title, badge, code, description, tags = [], note, trailing, onClick, control, detail, children, selected, current, expanded, tone }: ItemProps) {
  const windowed = useContext(Windowed);
  const places = useContext(Places);
  const slot = useMenuSlot();
  const self = useSeekRow<HTMLLIElement>(title);
  const end = trailing ?? ((places || (folder && expanded === undefined)) && onClick ? <Icon icon={ChevronRight} /> : undefined);
  const meta =
    code || tags.length > 0 ? (
      <>
        {code && <code className={styles.code}>{code}</code>}
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </>
    ) : undefined;
  const row = (
    <Item
      density="tall"
      scheme="list"
      leading={folder ? <FolderMark /> : leading}
      title={
        badge ? (
          <span className={styles.titled}>
            {title}
            <Tag tone="accent">{badge}</Tag>
          </span>
        ) : (
          title
        )
      }
      meta={meta}
      preview={description}
      trailing={
        (note || end) && (
          <span className={styles.end}>
            {note && <span className={styles.note}>{note}</span>}
            {end}
          </span>
        )
      }
      trailingWraps={Boolean(note)}
      pressed={selected}
      current={current && 'page'}
      expanded={expanded}
      tone={tone}
      onClick={onClick}
    />
  );
  const content = (
    <>
      {control ? (
        <div className={styles.withControl} onContextMenu={slot.onContextMenu}>
          {row}
          <span className={styles.control}>
            <MenuSlot value={slot.held}>{control}</MenuSlot>
          </span>
        </div>
      ) : (
        row
      )}
      {detail && <div className={styles.detail}>{detail}</div>}
      {children && <ul className={styles.nested}>{children}</ul>}
    </>
  );
  return windowed ? content : <li ref={self} className={styles.item}>{content}</li>;
}
