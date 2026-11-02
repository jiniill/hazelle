import { Timer, TriangleAlert } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import { Hint } from '../overlays/Hint';
import styles from './SendNote.module.css';

// onClick: the note opens where its reason is told at length, so it is a button and keeps no ⓘ of its own.
// spareLabel: the words already say the label, so it shows only where they fold.
type Props = { label: string; title: string; warning?: { words: string; why: string }; spareLabel?: boolean; onClick?: () => void };

export function SendNote({ label, title, warning, spareLabel, onClick }: Props) {
  const className = [styles.sendNote, warning && styles.warn, onClick && styles.press].filter(Boolean).join(' ');
  const body = (
    <>
      <Icon icon={warning ? TriangleAlert : Timer} size="sm" />
      <span className={spareLabel ? styles.spare : undefined}>{label}</span>
      {warning && <span className={styles.words}>{!spareLabel && '· '}{warning.words}</span>}
    </>
  );
  if (onClick)
    return (
      <button type="button" className={className} title={warning ? `${title} · ${warning.why}` : title} onClick={onClick}>
        {body}
      </button>
    );
  return (
    <span className={className} title={title}>
      {body}
      {warning && <Hint label={title}>{warning.why}</Hint>}
    </span>
  );
}
