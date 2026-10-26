import { Ban, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ImageIcon, Languages, Scissors, Square, TriangleAlert, WandSparkles } from 'lucide-react';
import { createContext, useContext, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Button } from '../controls/Button';
import { Facts, type FactItem } from '../collections/Facts';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import { Text } from '../foundation/Text';
import { QuoteShapeContext } from '../foundation/quotes';
import { useHover } from '../foundation/media';
import { Menu, MenuItem } from '../overlays/Menu';
import { RowMemoryContext } from '../collections/row-memory';
import { FitsWordsContext } from './Story';
import { MESSAGE, RAIL } from './readingRail';
import styles from './StoryMessage.module.css';

const BADGES_SHOWN = 2;

// The message whose time a tap shows, one at a time; its owner clears it (useTimePin), and rows outside one show none.
type TimePin = { pinned: string | null; pin: (id: string) => void };
export const TimePinContext = createContext<TimePin | null>(null);

export function useTimePin() {
  const [pinned, setPinned] = useState<string | null>(null);
  const value = useMemo(() => ({ pinned, pin: (id: string) => setPinned((current) => (current === id ? null : id)) }), [pinned]);
  return { value, clear: () => setPinned(null) };
}

type Props = {
  avatar: ReactNode;
  name: string;
  time: string;
  mine: boolean;
  // Which text the message shows, such as 번역; the tools switch it.
  mark?: string;
  // Short words tools put on the message, in one look whatever the tool; two show, and the rest count as +N.
  badges?: string[];
  children: ReactNode;
  after?: ReactNode;
  tools?: ReactNode;
  // Its key among the rows, which TimePinContext names.
  id: string;
  // Marked for a moment from this timestamp, again with each look; 0 for none. The collection brings the first marked
  // row into view, even when it has not been mounted.
  found?: number;
  // Marked while true, with no fade.
  marked?: boolean;
  // Still being written: its reading rail has no end yet.
  writing?: boolean;
};

export function StoryMessage({ avatar, name, time, mine, mark, badges = [], children, after, tools, id, found = 0, marked = false, writing = false }: Props) {
  const hover = useHover();
  const timePin = useContext(TimePinContext);
  const pinned = timePin?.pinned === id;
  const foundDelay = useMemo(() => `-${Math.max(0, Date.now() - found)}ms`, [found]);
  const memory = useContext(RowMemoryContext);
  const revisited = useRef(memory?.visited ?? false);
  // Phones have no hover, so a tap on the message itself shows its time; not one the story took, such as on a picture.
  const tap = (event: MouseEvent) => {
    if (!timePin || hover || event.defaultPrevented || (event.target as HTMLElement).closest('button, a, textarea')) return;
    timePin.pin(id);
  };
  return (
    <article className={`${styles.message} ${pinned ? styles.pinned : ''} ${revisited.current ? styles.revisited : ''} ${writing ? styles.writing : ''}`} onClick={tap} {...{ [MESSAGE]: '' }}>
      {found !== 0 && <span key={found} className={styles.found} style={{ animationDelay: foundDelay }} aria-hidden />}
      {marked && <span className={styles.marked} aria-hidden />}
      <div className={styles.side}>
        {avatar}
        <div className={styles.rail} aria-hidden {...{ [RAIL]: '' }}>
          <div className={styles.reading}>
            <span className={styles.track}>
              <span className={styles.fill} />
            </span>
          </div>
        </div>
      </div>
      <div className={styles.main}>
        <Speech
          name={name}
          mine={mine}
          head={
            <>
              {mark && <span className={styles.mark}>{mark}</span>}
              {badges.slice(0, BADGES_SHOWN).map((badge, index) => <span key={index} className={styles.badge}>{badge}</span>)}
              {badges.length > BADGES_SHOWN && <span className={styles.badge} title={badges.slice(BADGES_SHOWN).join(' · ')}>{`+${badges.length - BADGES_SHOWN}`}</span>}
              <span className={styles.time}>{time}</span>
            </>
          }
        >
          {children}
        </Speech>
        {/* The foot keeps its height while the tools are absent, as while a reply streams, so nothing moves when they come. */}
        <div className={styles.foot}>
          <div className={styles.after}>{after}</div>
          {tools && <div className={styles.tools}>{tools}</div>}
        </div>
      </div>
    </article>
  );
}

// Who speaks and what they said, as the chat and its exported log (LogExport) both draw it; head: what stands by the name.
export function Speech({ name, mine, head, children }: { name: string; mine: boolean; head?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className={styles.head}>
        <span className={mine ? styles.me : styles.name}>{name}</span>
        {head}
      </div>
      {/* The bubble is already a box: its dialogue keeps to color, whatever 대사 모양 says. */}
      {mine ? <div className={styles.bubble}><FitsWordsContext value><QuoteShapeContext value="color">{children}</QuoteShapeContext></FitsWordsContext></div> : children}
    </>
  );
}

export function Waiting({ note }: { note: string }) {
  return (
    <>
      <span className={styles.waiting} aria-label="응답 기다리는 중">
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
      </span>
      <Text variant="note">{note}</Text>
    </>
  );
}

type Step = { label: string; title?: string; disabled?: boolean; onClick: () => void };

type SwitcherProps = {
  // Where it stands among the rest, such as 2 / 5; '' for nowhere yet.
  count: string;
  prev: Step;
  next: Step;
  // The versions to pick from by the count; without, the count is only read out as it changes.
  pick?: { versions: string[]; selected: number; disabled: boolean; onPick: (index: number) => void };
  // down: to what stands above and below, such as search hits.
  axis?: 'across' | 'down';
};

export function Switcher({ count, prev, next, pick, axis = 'across' }: SwitcherProps) {
  const [before, after] = axis === 'across' ? [ChevronLeft, ChevronRight] : [ChevronUp, ChevronDown];
  return (
    <div className={pick ? `${styles.switcher} ${styles.versions}` : styles.switcher}>
      <IconButton icon={before} label={prev.label} title={prev.title} size="sm" disabled={prev.disabled} onClick={prev.onClick} />
      {pick ? (
        <Menu
          label="버전 선택"
          place="above-start"
          trigger={(opener) => (
            <button type="button" className={styles.count} title="버전 선택" disabled={pick.disabled} ref={opener.ref} aria-haspopup={opener.popup} aria-expanded={opener.expanded} onClick={opener.onClick}>
              {count}
            </button>
          )}
        >
          {pick.versions.map((line, index) => (
            <MenuItem key={index} label={`${index + 1}`} sub={line} checked={index === pick.selected} onClick={() => pick.onPick(index)} />
          ))}
        </Menu>
      ) : (
        count && <span className={styles.count} aria-live="polite">{count}</span>
      )}
      <IconButton icon={after} label={next.label} title={next.title} size="sm" disabled={next.disabled} onClick={next.onClick} />
    </div>
  );
}

type MarkerProps = { reason: 'length' | 'stopped' | 'refused' | 'translation' | 'illustration' | 'agent'; label: string; action?: { label: string; disabled: boolean; onClick: () => void } };
const MARKS = { length: Scissors, stopped: Square, refused: Ban, translation: Languages, illustration: ImageIcon, agent: WandSparkles };

export function Marker({ reason, label, action }: MarkerProps) {
  return (
    <div className={reason === 'stopped' ? `${styles.marker} ${styles.stopped}` : styles.marker}>
      <Icon icon={MARKS[reason]} size="sm" />
      <span>{action ? `${label} ·` : label}</span>
      {action && (
        <Button variant="link" size="xs" disabled={action.disabled} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// A reply's usage at the end of its text: a line that opens its facts below it, and from them the whole account (more).
// Not in the foot's markers: the foot sticks to the bottom of the view, and the opened facts would stick with it.
// A fact on the usage line: its number bright, the word naming it faint; a fact its number names alone has no label.
export type UsagePart = { label?: string; value: string };

// lead: the fact read first (a cost), bold before the rest; null leaves the line to the rest.
export function Usage({ lead, parts, facts, more }: { lead: string | null; parts: UsagePart[]; facts: FactItem[]; more: { label: string; onClick: () => void } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.usage}>
      <button type="button" className={styles.usageLine} aria-expanded={open} onClick={() => setOpen(!open)}>
        {lead && <span className={styles.usageLead}>{lead}</span>}
        {parts.map(({ label, value }, index) => (
          // The dot ends the fact before it, so a line the strip wraps onto never starts with one.
          <span key={label ?? value} className={styles.usagePart}>
            {label && `${label} `}
            <span className={styles.usageValue}>{value}</span>
            {index < parts.length - 1 && (
              <span className={styles.usageDot} aria-hidden>
                ·
              </span>
            )}
          </span>
        ))}
        <Icon icon={open ? ChevronUp : ChevronDown} size="sm" />
      </button>
      {open && (
        <div className={styles.usageFacts}>
          <Facts items={facts} />
          <Button variant="link" size="xs" onClick={more.onClick}>
            {more.label}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Failure({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className={styles.failure} role="alert">
      <span className={styles.failureTitle}>
        <Icon icon={TriangleAlert} size="sm" />
        {title}
      </span>
      <p className={styles.failureText}>{children}</p>
      <div className={styles.failureActions}>{actions}</div>
    </div>
  );
}
