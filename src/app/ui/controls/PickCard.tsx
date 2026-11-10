import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Icon } from '../foundation/Icon';
import { Hint, type Help } from '../overlays/Hint';
import styles from './PickCard.module.css';

type Props = {
  label: string;
  value: string;
  note?: string;
  help?: Help;
  // warn: the value names something missing.
  tone?: 'plain' | 'warn';
  // A menu's opener (from Menu's trigger), or none for a card that opens a place.
  popup?: 'menu';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

// Picks that lead a page together: side by side as tiles, and on a phone one box of rows.
export function PickCards({ children }: { children: ReactNode }) {
  return <div className={styles.picks}>{children}</div>;
}

export function PickCard({ label, value, note, help, tone = 'plain', popup, expanded, ref, onClick }: Props) {
  // The ⓘ is a button of its own, so it stands over the card's corner, not inside the card's button.
  return (
    <div className={help ? `${styles.pick} ${styles.helped}` : styles.pick}>
      <button ref={ref} type="button" className={styles.card} aria-label={`${label} · ${value}`} aria-haspopup={popup} aria-expanded={popup ? expanded : undefined} onClick={onClick}>
        <span className={styles.label}>{label}</span>
        <span className={styles.line}>
          <span className={tone === 'warn' ? `${styles.value} ${styles.warn}` : styles.value}>{value}</span>
          <Icon icon={popup ? ChevronDown : ChevronRight} size="sm" />
        </span>
        {note && <span className={styles.detail}>{note}</span>}
      </button>
      {help && (
        <span className={styles.help}>
          <Hint label={label}>{help}</Hint>
        </span>
      )}
    </div>
  );
}
