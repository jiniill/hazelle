import { ArrowUp, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { classNames } from '../foundation/classNames';
import styles from './DemoParts.module.css';

// The parts every drawing is drawn with. A part only looks: the drawing places it and moves it with its own class
// (motion), from a step of the round (at, a share of --duration-demo).
type Moves = { motion?: string | false; at?: number };

// The shared motions: comes into view at its step and stays; is pressed at its step. And the shared places: a feed
// from the stage's top, a composer at its bottom.
export const appears = styles.appears;
export const pressed = styles.pressed;
export const top = styles.top;
export const dock = styles.dock;

export const when = (at: number | undefined, more?: Record<`--${string}`, string | number>) => (at === undefined && !more ? undefined : ({ '--at': at, ...more }) as CSSProperties);

// A message's lines, each a share of its width.
export type Lines = readonly number[];

// typing: when its first line starts being written; each next line starts a step after.
export function Message({ lines, mine = false, typing, motion, at, children }: Moves & { lines: Lines; mine?: boolean; typing?: number; children?: ReactNode }) {
  return (
    <span className={classNames(styles.message, mine && styles.mine, motion)} style={when(at)}>
      {lines.map((width, line) => (
        <Line key={line} width={width} typing={typing === undefined ? undefined : typing + line * 0.08} />
      ))}
      {children}
    </span>
  );
}

export function Line({ width, typing, motion }: { width: number; typing?: number; motion?: string | false }) {
  return <span className={classNames(styles.line, typing !== undefined && styles.typed, motion)} style={when(typing, { '--w': `${width}%` })} />;
}

export function Feed({ motion, at, children }: Moves & { children: ReactNode }) {
  return (
    <span className={classNames(styles.feed, motion)} style={when(at)}>
      {children}
    </span>
  );
}

export function Header({ motion, at }: Moves) {
  return (
    <span className={classNames(styles.header, motion)} style={when(at)}>
      <span className={styles.face} />
      <span className={styles.title} />
      <span className={styles.tools}>
        <span />
        <span />
      </span>
    </span>
  );
}

// note: what stands beside the send button. sent: when the send button is pressed.
export function Composer({ motion, at, note, sent, children }: Moves & { note?: ReactNode; sent?: number; children?: ReactNode }) {
  return (
    <span className={classNames(styles.composer, motion)} style={when(at)}>
      <span className={styles.draft}>{children ?? <Line width={40} />}</span>
      {note}
      <span className={classNames(styles.send, sent !== undefined && styles.pressed)} style={when(sent)}>
        <Icon icon={ArrowUp} size="sm" />
      </span>
    </span>
  );
}

// A round button with a glyph; wide holds it as a pill.
export function Glyph({ icon, wide = false, motion, at }: Moves & { icon: LucideIcon; wide?: boolean }) {
  return (
    <span className={classNames(styles.glyph, wide && styles.wide, motion)} style={when(at)}>
      <Icon icon={icon} size="sm" />
    </span>
  );
}

// A picture: a sun over a hill, or the figures given standing in it. ratio: its width over its height.
export function Picture({ ratio, motion, at, children }: Moves & { ratio: number; children?: ReactNode }) {
  return (
    <span className={classNames(styles.picture, motion)} style={when(at, { '--ratio': ratio })}>
      {children}
    </span>
  );
}

// A person in a picture; the persona in the accent.
export function Figure({ persona = false, motion, at }: Moves & { persona?: boolean }) {
  return <span className={classNames(styles.figure, persona && styles.persona, motion)} style={when(at)} />;
}

export function Key({ motion, at, children }: Moves & { children: string }) {
  return (
    <span className={classNames(styles.key, motion)} style={when(at)}>
      {children}
    </span>
  );
}

// Opens to its content's height at its step; away, closes then.
export function Unfold({ at, away = false, children }: { at: number; away?: boolean; children: ReactNode }) {
  return (
    <span className={classNames(styles.unfold, away && styles.away)} style={when(at)}>
      <span className={styles.folding}>{children}</span>
    </span>
  );
}

// The sample story the drawings that show words read, translated and as written.
export const PARAGRAPHS = [
  { translated: '미라는 창가에 앉아 빗소리를 들었다. 오늘따라 오후가 유난히 길었다.', original: 'Mira sat by the window, listening to the rain. The afternoon felt unusually long.' },
  { translated: '“차 한 잔 더 할래?” 그녀가 조용히 물었다.', original: '“Another cup of tea?” she asked quietly.' },
] as const;
