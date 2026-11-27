import { Timer, TriangleAlert } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Icon } from '../foundation/Icon';
import { Hint } from '../overlays/Hint';
import styles from './SendNote.module.css';
import { classNames } from '../foundation/classNames';

// onClick: the note opens where its reason is told at length, so it is a button and keeps no ⓘ of its own.
// spareLabel: the words already say the label, so it shows only where they fold.
// share: how much of the request the cache answers, 0 to 1, drawn as a small bar in the icon's place.
type Props = { label: string; title: string; share?: number; warning?: { words: string; why: string }; spareLabel?: boolean; onClick?: () => void };

export function SendNote({ label, title, share, warning, spareLabel, onClick }: Props) {
  const className = classNames(styles.sendNote, warning && styles.warn, onClick && styles.press);
  const body = (
    <>
      {share === undefined ? (
        <Icon icon={warning ? TriangleAlert : Timer} size="sm" />
      ) : (
        <span className={styles.track} aria-hidden>
          <span className={styles.fill} style={{ '--share': share } as CSSProperties} />
        </span>
      )}
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
