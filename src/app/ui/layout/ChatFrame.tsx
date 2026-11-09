import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref, type RefObject } from 'react';
import { IconButton } from '../controls/IconButton';
import { faceStyle, FONTS, type FontId } from '../foundation/fonts';
import { usePanelsBeside, useShortWide } from '../foundation/media';
import { useReadingRail } from '../story/readingRail';
import styles from './ChatFrame.module.css';
import { tokenPx } from '../foundation/tokenPx';

type Spacing = 'narrow' | 'normal' | 'wide' | 'widest';

// How the story reads (읽기 설정). tokens.css holds each look; reply is how the view meets a reply (useFollow).
export type Reading = { font: FontId; size: number; leading: Spacing; width: Spacing; reply: 'follow' | 'stay' };

// The look before any reading setting. The size is read from tokens.css, not repeated here, since Story keeps it
// outside the chat.
export const readingDefault = (): Reading => ({
  font: 'serif',
  size: tokenPx('--prose-size'),
  leading: 'normal',
  width: 'normal',
  reply: 'follow',
});

const LEADING: Record<Spacing, string> = { narrow: styles.leadingNarrow, normal: styles.leadingNormal, wide: styles.leadingWide, widest: styles.leadingWidest };
const WIDTH: Record<Spacing, string> = { narrow: styles.widthNarrow, normal: styles.widthNormal, wide: styles.widthWide, widest: styles.widthWidest };

// The reading settings on the element a story sits in: the chat's column, or an exported log (LogExport).
export const readingScope = ({ font, size, leading, width }: Reading) => ({ className: `${styles[FONTS[font].kind]} ${LEADING[leading]} ${WIDTH[width]}`, style: { ...faceStyle(font), '--reading-size': `${size}px` } as CSSProperties });

// Which side of the story the stage stands on.
export type StageSide = 'right' | 'left';

// Inline illustrations move onto the stage only when it is at least half text width; portrait-only stages do not qualify.
const MarginRoom = createContext<StageSide | false>(false);
export const useMarginRoom = () => useContext(MarginRoom);

type Props = {
  back?: { label: string; onClick: () => void };
  title: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  above: ReactNode;
  footer: ReactNode;
  // The composer with its cards, which the toasts stand above.
  dockRef: Ref<HTMLDivElement>;
  panel?: ReactNode;
  // A second panel kept open right of panel, drawn only where both stand beside the page: covering it, each would
  // close the other.
  beside?: ReactNode;
  peek?: ReactNode;
  // Lies under the whole column, the header, story and composer over it: a bot's background (StoryBackdrop).
  backdrop?: ReactNode;
  // Stands in the story's right gutter, from under the header down to the composer, at the gutter's foot.
  edge?: ReactNode;
  reading: Reading;
  hideHeader: boolean;
  // Reserve stage space before the first illustration lands, not after it shifts the text.
  stage: boolean;
  side: StageSide;
  // The character's picture, standing on the stage where no 삽화 do.
  portrait?: string;
  // A character's own look for the lines that are only a picture, over the defaults in tokens.css.
  // wideFill false holds a picture wider than tall to widest too.
  pictures?: { fold?: false; peek?: number; widest?: number; wideFill?: boolean };
  compact: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
};

export function ChatFrame({ back, title, actions, children, above, footer, dockRef, panel, beside, peek, backdrop, edge, reading, hideHeader, stage, side, portrait, pictures, compact, scrollRef, onScroll }: Props) {
  const scope = readingScope(reading);
  const pairs = usePanelsBeside();
  // A phone on its side leaves the story too little height to keep the header over it.
  const hides = useShortWide() || hideHeader;
  const [shown, setShown] = useState(true);
  const lastTop = useRef(0);
  const columnRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  // Reserve the fully expanded composer height so folding cannot shift the story/scroll position.
  // Skip transitions only, not animations such as spinners.
  const [space, setSpace] = useState(0);
  const [scrollbar, setScrollbar] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ stage: 0, lead: 0, text: 0, page: 0, story: 0 });
  const staged = (stage || !!portrait) && room.stage >= room.text / 2;
  // lead is the gap on the stage's far side, so a stage on the left stands in the story's lead.
  const storyLead = side === 'right' ? room.lead : room.page - room.story - room.lead;
  const widest = pictures?.widest && `${pictures.widest}%`;
  useReadingRail(scrollRef, footerRef);

  useLayoutEffect(() => {
    const element = footerRef.current!;
    const measure = () => {
      // Follow the fold's measured height before paint, outside React, without rendering every animation frame.
      columnRef.current!.style.setProperty('--footer-height', `${element.offsetHeight}px`);
      if (element.matches(`.${styles.compact}:not(:focus-within)`)) return;
      if (element.getAnimations({ subtree: true }).some((animation) => animation instanceof CSSTransition)) return;
      setSpace(element.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('transitionend', measure);
    element.addEventListener('transitioncancel', measure);
    return () => {
      observer.disconnect();
      element.removeEventListener('transitionend', measure);
      element.removeEventListener('transitioncancel', measure);
    };
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current!;
    const content = contentRef.current!;
    const measure = () => {
      setScrollbar(element.offsetWidth - element.clientWidth);
      // Center story + stage when space allows; otherwise preserve the minimum lead and room for the gap/SidePeek tab.
      // Cap stage width at story width and keep left/right layouts symmetric.
      const style = getComputedStyle(content);
      const least = tokenPx('--read-stage-least', content);
      const stage = Math.max(0, Math.min(content.offsetWidth, element.clientWidth - content.offsetWidth - least - tokenPx('--space-16', content) - tokenPx('--peek-tab-width', content)));
      const lead = Math.max(least, (element.clientWidth - content.offsetWidth - stage) / 2);
      setRoom({ stage, lead, text: content.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), page: element.clientWidth, story: content.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollRef]);

  // A move that ends at the story's end is the view following it (the story shrank as its font loaded, a reply
  // grew), not the reader going up.
  function scrolled() {
    const element = scrollRef.current!;
    const top = element.scrollTop;
    const end = element.scrollHeight - top - element.clientHeight < 1;
    if (top !== lastTop.current) setShown(top === 0 || (top < lastTop.current && !end));
    lastTop.current = top;
    onScroll();
  }

  return (
    <div className={styles.frame}>
      <main
        ref={columnRef}
        className={`${styles.column} ${scope.className} ${staged ? styles.staged : ''} ${backdrop ? styles.backdropped : ''}`}
        style={
          {
            ...scope.style,
            '--footer-space': `${space}px`,
            '--story-scrollbar': `${scrollbar}px`,
            '--story-margin': `${room.stage}px`,
            '--story-stage-lead': `${storyLead}px`,
            '--story-stage-at': `${side === 'right' ? storyLead + room.story : storyLead - room.stage}px`,
            '--story-picture-peek': pictures?.fold === false ? 'none' : pictures?.peek && `${pictures.peek}vh`,
            '--story-picture-widest': widest,
            '--story-picture-wide': pictures?.wideFill === false ? widest : undefined,
          } as CSSProperties
        }
      >
        {backdrop && <div className={styles.backdrop}>{backdrop}</div>}
        <div className={`${styles.top} ${shown || !hides ? styles.shown : ''}`}>
          <header className={styles.header}>
            {back && <IconButton icon={ChevronLeft} label={back.label} onClick={back.onClick} />}
            <div className={styles.title}>{title}</div>
            <div className={styles.actions}>{actions}</div>
          </header>
        </div>
        <div className={styles.scroll} ref={scrollRef} onScroll={scrolled}>
          <div ref={contentRef} className={styles.content}>
            <MarginRoom.Provider value={staged && stage && side}>{children}</MarginRoom.Provider>
          </div>
        </div>
        {staged && !stage && (
          <div className={styles.portrait}>
            <img src={portrait} alt="" />
          </div>
        )}
        {peek}
        <div className={styles.edge}>
          <div className={styles.gutter}>{edge}</div>
        </div>
        <div ref={footerRef} className={`${styles.footer} ${compact ? styles.compact : ''}`}>
          <div className={styles.above}>{above}</div>
          <div ref={dockRef} className={styles.dock}>{footer}</div>
        </div>
      </main>
      {panel}
      {pairs && beside}
    </div>
  );
}

// name: the character's, with its face; sub: the chat's name under them. Two targets: the face and name open the
// character (onClick, expanded), and the chat's name renames it (onRename).
type TitleProps = {
  name: string;
  sub?: string;
  face?: ReactNode;
  expanded?: boolean;
  onClick?: () => void;
  onRename?: () => void;
};

export function ChatTitle({ name, sub, face, expanded, onClick, onRename }: TitleProps) {
  const who = (
    <>
      {face}
      <span className={styles.name}>{name}</span>
      {onClick && <ChevronRight className={styles.chevron} size={16} aria-hidden />}
    </>
  );
  const under = face ? `${styles.sub} ${styles.beside}` : styles.sub;
  return (
    <h1 className={styles.heading}>
      {onClick ? (
        <button type="button" className={`${styles.who} ${styles.press}`} aria-expanded={expanded} onClick={onClick}>
          {who}
        </button>
      ) : (
        <span className={styles.who}>{who}</span>
      )}
      {sub && (onRename ? <button type="button" className={`${under} ${styles.press}`} onClick={onRename}>{sub}</button> : <span className={under}>{sub}</span>)}
    </h1>
  );
}
