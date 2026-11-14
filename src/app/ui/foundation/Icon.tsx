import { Check, CircleAlert, Star, type LucideIcon } from 'lucide-react';
import styles from './Icon.module.css';

export function Icon({ icon: Glyph, size = 'md' }: { icon: LucideIcon; size?: 'sm' | 'md' }) {
  return <Glyph className={`${styles.icon} ${styles[size]}`} aria-hidden />;
}

// The mark of a row whose thing cannot run now: why, to a pointer resting on it and to a screen reader.
export function ErrorMark({ why }: { why: string }) {
  return (
    <span className={styles.error} role="img" aria-label={why} title={why}>
      <Icon icon={CircleAlert} size="sm" />
    </span>
  );
}

// The mark of a thing its owner starred, filled in the accent: label names it to a screen reader.
export function StarMark({ label }: { label: string }) {
  return (
    <span className={styles.star} role="img" aria-label={label}>
      <Icon icon={Star} size="sm" />
    </span>
  );
}

// The mark of the one chosen among rows: a checked menu item, a selected list row.
export function CheckMark() {
  return (
    <span className={styles.check}>
      <Icon icon={Check} size="sm" />
    </span>
  );
}
