import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Sketch.module.css';

// Decorative mock content only (aria-hidden); nearby tour copy carries meaning, never real user content.
export function Sketch({ badge, children }: { badge?: number; children: ReactNode }) {
  return (
    <div className={styles.sketch} aria-hidden>
      {badge !== undefined && <span className={styles.badge}>{badge}</span>}
      {children}
    </div>
  );
}

// indent: a 답글 under its comment. accent: the row the page is about.
function SketchRow({ indent = false, accent = false, children }: { indent?: boolean; accent?: boolean; children: ReactNode }) {
  return <div className={[styles.row, indent && styles.indent, accent && styles.accent].filter(Boolean).join(' ')}>{children}</div>;
}

function SketchLine({ width }: { width: 'short' | 'medium' | 'long' }) {
  return <span className={`${styles.line} ${styles[width]}`} />;
}

function SketchMark({ icon, count, lit = false }: { icon: LucideIcon; count?: number; lit?: boolean }) {
  return (
    <span className={lit ? `${styles.mark} ${styles.lit}` : styles.mark}>
      <Icon icon={icon} size="sm" />
      {count}
    </span>
  );
}

Sketch.Row = SketchRow;
Sketch.Line = SketchLine;
Sketch.Mark = SketchMark;
