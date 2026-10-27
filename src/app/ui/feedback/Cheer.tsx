import { Sparkle, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import styles from './Cheer.module.css';

const TONES = [styles.accent, styles.rose, styles.blue, styles.green, styles.violet];
// Spread evenly round the badge, each a little off its place and at its own reach, so the burst reads as thrown.
const PIECES = Array.from({ length: 40 }, (_, i) => ({
  turn: i / 40 + (((i * 37) % 7) - 3) / 280,
  reach: 0.45 + ((i * 53) % 11) / 20,
  tone: TONES[i % TONES.length],
  round: i % 3 === 0,
}));

export function Cheer({ icon: Glyph }: { icon: LucideIcon }) {
  return (
    <div className={styles.cheer} aria-hidden>
      <span className={styles.ripple} />
      <span className={`${styles.ripple} ${styles.later}`} />
      {PIECES.map((piece, index) => (
        <span key={index} className={`${styles.piece} ${piece.tone}${piece.round ? ` ${styles.round}` : ''}`} style={{ '--turn': piece.turn, '--reach': piece.reach } as CSSProperties} />
      ))}
      <Sparkle className={`${styles.spark} ${styles.left}`} />
      <Sparkle className={`${styles.spark} ${styles.right}`} />
      <Sparkle className={`${styles.spark} ${styles.low}`} />
      <span className={styles.badge}>
        <Glyph className={styles.glyph} />
      </span>
    </div>
  );
}
