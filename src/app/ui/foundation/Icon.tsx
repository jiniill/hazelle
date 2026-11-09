import { Check, type LucideIcon } from 'lucide-react';
import styles from './Icon.module.css';

export function Icon({ icon: Glyph, size = 'md' }: { icon: LucideIcon; size?: 'sm' | 'md' }) {
  return <Glyph className={`${styles.icon} ${styles[size]}`} aria-hidden />;
}

// The mark of the one chosen among rows: a checked menu item, a selected list row.
export function CheckMark() {
  return (
    <span className={styles.check}>
      <Icon icon={Check} size="sm" />
    </span>
  );
}
