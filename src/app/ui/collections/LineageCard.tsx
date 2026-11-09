import type { ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import { RowControl } from './RowControl';
import styles from './LineageCard.module.css';
import { classNames } from '../foundation/classNames';

type Props = {
  title: string;
  // Under the title: what it holds and when, such as 31개 · 방금.
  note?: string;
  // Before the note: where it came from (원본, 25번째에서, 사본).
  tag?: string;
  preview?: string;
  // copy: a dashed frame. ghost: a dotted one with no fill, its title muted, standing in for a chat gone.
  variant?: 'plain' | 'copy' | 'ghost';
  current?: boolean;
  // accent: on the way to the current chat.
  tone?: 'plain' | 'accent';
  // Its ⋯, in its corner.
  control?: ReactNode;
  onClick?: () => void;
};

const FRAMES = { plain: '', copy: styles.copy, ghost: styles.ghost };

export function LineageCard({ title, note, tag, preview, variant = 'plain', current = false, tone = 'plain', control, onClick }: Props) {
  const classes = classNames(styles.card, FRAMES[variant], current && styles.current);
  const content = (
    <>
      <span className={styles.title}>
        {current && <span className={styles.spark} aria-hidden />}
        {title}
      </span>
      {(tag !== undefined || note !== undefined) && (
        <span className={styles.meta}>
          {tag !== undefined && <Tag tone={tone === 'accent' ? 'accent' : 'faint'}>{tag}</Tag>}
          {note}
        </span>
      )}
      {preview !== undefined && <span className={styles.preview}>{preview}</span>}
    </>
  );
  return (
    <RowControl control={control} corner>
      {onClick ? (
        <button type="button" className={classes} aria-current={current || undefined} onClick={onClick}>
          {content}
        </button>
      ) : (
        <div className={classes}>{content}</div>
      )}
    </RowControl>
  );
}
