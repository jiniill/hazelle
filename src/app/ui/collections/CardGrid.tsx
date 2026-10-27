import { Check, GripVertical, type LucideIcon } from 'lucide-react';
import { Fragment, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { bothDrops, cardDrag, useCardDrop, useCardPlace } from './cardDrag';
import { CardOrderScope, useOrderHandle } from './cardOrder';
import { FolderMark } from './FolderMark';
import { Viewport } from './Viewport';
import { Avatar } from '../foundation/Avatar';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { useVeil } from '../foundation/veil';
import { MenuSlot, useMenuSlot } from '../overlays/MoreMenu';
import styles from './CardGrid.module.css';

const STEPS: Record<string, (columns: number) => number> = { ArrowLeft: () => -1, ArrowRight: () => 1, ArrowUp: (columns) => -columns, ArrowDown: (columns) => columns };

// face: square pictures of people (personas) at a smaller width than characters' portraits. current: the key brought
// into view when it changes.
type GridProps = { label: string; keys: readonly string[]; variant?: 'portrait' | 'face'; current?: string; children: (index: number) => ReactNode };

export function CardGrid({ label, keys, variant = 'portrait', current, children }: GridProps) {
  const root = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  useLayoutEffect(() => {
    const element = root.current!;
    const read = () => setColumns(getComputedStyle(element).gridTemplateColumns.split(' ').length);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const rows = Array.from({ length: Math.ceil(keys.length / columns) }, (_, i) => JSON.stringify(keys.slice(i * columns, (i + 1) * columns)));
  const at = current === undefined ? -1 : keys.indexOf(current);
  // Arrows move between the cards drawn; a row the viewport has not drawn yet is reached by scrolling.
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step = STEPS[event.key];
    const cards = [...root.current!.querySelectorAll<HTMLButtonElement>(`.${styles.card}`)];
    const from = cards.indexOf(event.target as HTMLButtonElement);
    if (!step || from === -1) return;
    const to = cards[from + step(columns)];
    if (!to) return;
    event.preventDefault();
    to.focus();
  }
  return <div ref={root} className={variant === 'face' ? `${styles.grid} ${styles.face}` : styles.grid} role="group" aria-label={label} onKeyDown={move}>
    <div className={styles.window}>
      <CardOrderScope root={root} keys={keys}>
        <Viewport keys={rows} variant="grid" current={at === -1 ? undefined : rows[Math.floor(at / columns)]}>{(row) => <div className={styles.cards} style={{ '--card-columns': columns } as CSSProperties}>
          {keys.slice(row * columns, (row + 1) * columns).map((key, column) => <Fragment key={key}>{children(row * columns + column)}</Fragment>)}
        </div>}</Viewport>
      </CardOrderScope>
    </div>
  </div>;
}

type CardProps = {
  image: string | null;
  // image is a video's URL: the card shows its first frame.
  video?: boolean;
  name: string;
  note: string;
  // null while the grid is not picking characters.
  selected: boolean | null;
  // The one in use, outlined, apart from a pick of several.
  current?: boolean;
  tag?: string;
  // A note that says what is missing reads fainter than a real one.
  faint?: boolean;
  onClick: () => void;
  popup?: 'menu' | 'dialog';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  menu?: ReactNode;
  // The card can be dragged onto a FolderCard or a PathBar part, or beside another card, carrying this key.
  drag?: string;
  // Another card's key let go beside this one.
  onPlace?: (key: string, after: boolean) => void;
  // 순서 바꾸기: the card shows a handle that moves it (cardOrder), labelled label.
  arrange?: { key: string; label: string };
};

const placing = { before: styles.placeBefore, after: styles.placeAfter };

type Handle = NonNullable<ReturnType<typeof useOrderHandle>>;
const boxClass = (side: 'before' | 'after' | null, handle: Handle | null) => [styles.cardBox, side && placing[side], handle?.held && styles.held].filter(Boolean).join(' ');

function OrderHandle({ handle }: { handle: Handle }) {
  return (
    <button type="button" className={styles.handle} {...handle.handle}>
      <Icon icon={GripVertical} size="sm" />
    </button>
  );
}

export function FaceCard({ image, video = false, name, note, selected, current = false, tag, faint = false, onClick, popup, expanded, ref, menu, drag, onPlace, arrange }: CardProps) {
  const slot = useMenuSlot();
  const place = useCardPlace(onPlace, 'card');
  const handle = useOrderHandle(arrange, 'card', onPlace);
  return (
    <div className={boxClass(place.side ?? handle?.side ?? null, handle)} onContextMenu={slot.onContextMenu} {...handle?.box}>
      <button
        ref={ref}
        type="button"
        className={[styles.card, selected && styles.selected, current && styles.current].filter(Boolean).join(' ')}
        aria-pressed={selected ?? undefined}
        aria-current={current || undefined}
        aria-haspopup={popup}
        aria-expanded={expanded}
        onClick={onClick}
        {...(drag === undefined ? {} : cardDrag(drag))}
        {...place.props}
      >
        <span className={styles.picture}>
          <Face image={image} video={video} name={name} still={drag !== undefined} />
          {selected !== null && <span className={styles.check}>{selected && <Icon icon={Check} size="sm" />}</span>}
        </span>
        <span className={styles.name}>{name}</span>
        <span className={faint ? `${styles.detail} ${styles.faint}` : styles.detail}>{note}</span>
        {/* After the name, so the card is named by its name first; drawn over the picture's corner. */}
        {tag && <span className={styles.tag}><Tag tone="accent">{tag}</Tag></span>}
      </button>
      {handle && <OrderHandle handle={handle} />}
      {menu && (
        <div className={styles.menu}>
          <MenuSlot value={slot.held}>{menu}</MenuSlot>
        </div>
      )}
    </div>
  );
}

export function IconCard({ icon, name, note, onClick }: { icon: LucideIcon; name: string; note: string; onClick: () => void }) {
  return (
    <div className={styles.cardBox}>
      <button type="button" className={styles.card} onClick={onClick}>
        <span className={`${styles.picture} ${styles.iconPicture}`}>
          <Icon icon={icon} />
        </span>
        <span className={styles.name}>{name}</span>
        <span className={styles.detail}>{note}</span>
      </button>
    </div>
  );
}

// Keep each preview face in its own quarter even with fewer than four, never full-size like a character.
// Folder drag/order uses its own key type; onDropCard receives a character/persona key.
type FolderCardProps = { name: string; note: string; faces: { image: string | null; name: string }[]; onClick: () => void; menu?: ReactNode; onDropCard?: (key: string) => void; drag?: string; onPlace?: (key: string, after: boolean) => void; arrange?: { key: string; label: string } };

export function FolderCard({ name, note, faces, onClick, menu, onDropCard, drag, onPlace, arrange }: FolderCardProps) {
  const drop = useCardDrop(onDropCard);
  const place = useCardPlace(onPlace, 'folder');
  const handle = useOrderHandle(arrange, 'folder', onPlace);
  const slot = useMenuSlot();
  const shown = faces.slice(0, 4);
  return (
    <div className={boxClass(place.side ?? handle?.side ?? null, handle)} onContextMenu={slot.onContextMenu} {...handle?.box}>
      <button type="button" className={drop.over ? `${styles.card} ${styles.dropping}` : styles.card} onClick={onClick} {...(drag === undefined ? {} : cardDrag(drag, 'folder'))} {...bothDrops(drop.props, place.props)}>
        <span className={styles.folder}>
          <span className={styles.tab} />
          <span className={styles.body}>
            {shown.length === 0 ? (
              <span className={styles.emptyFolder}>
                <FolderMark size="md" />
              </span>
            ) : (
              [...shown, ...Array<null>(4 - shown.length).fill(null)].map((face, index) => <span key={index} className={styles.slot}>{face && <Face {...face} still={drag !== undefined} />}</span>)
            )}
          </span>
        </span>
        <span className={styles.name}>{name}</span>
        <span className={styles.detail}>{note}</span>
      </button>
      {handle && <OrderHandle handle={handle} />}
      {menu && (
        <div className={styles.menu}>
          <MenuSlot value={slot.held}>{menu}</MenuSlot>
        </div>
      )}
    </div>
  );
}

export function Portrait({ image, name }: { image: string | null; name: string }) {
  return (
    <span className={styles.portrait}>
      <Face image={image} name={name} />
    </span>
  );
}

export function Preview({ image, video = false, name }: { image: string | null; video?: boolean; name: string }) {
  const veil = useVeil();
  if (!image || veil) return <span className={styles.preview}><Face image={null} name={name} /></span>;
  return <span className={styles.preview}>{video ? <video className={styles.whole} src={image} aria-label={name} controls autoPlay muted loop playsInline /> : <img className={styles.whole} src={image} alt={name} />}</span>;
}

// still: the picture does not drag itself, so the card it sits in drags instead (cardDrag).
function Face({ image, video = false, name, still = false }: { image: string | null; video?: boolean; name: string; still?: boolean }) {
  const veil = useVeil();
  if (!image || veil) return <Avatar face={name} size="fill" />;
  return video ? <video className={styles.image} src={image} aria-hidden="true" muted playsInline preload="metadata" draggable={still ? false : undefined} /> : <img className={styles.image} src={image} alt="" draggable={still ? false : undefined} />;
}

export function SelectionBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}
