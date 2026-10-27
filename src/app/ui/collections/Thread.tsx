import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Thread.module.css';

export function Thread({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className={styles.thread} aria-label={label}>
      {children}
    </ul>
  );
}

type Props = {
  byline: ReactNode;
  control?: ReactNode;
  children: ReactNode;
  foot?: ReactNode;
  // ThreadItems answering it, a step in along a line.
  replies?: ReactNode;
};

export function ThreadItem({ byline, control, children, foot, replies }: Props) {
  return (
    <li className={styles.item}>
      <div className={styles.head}>
        {byline}
        {control && <span className={styles.control}>{control}</span>}
      </div>
      <div className={styles.body}>
        {children}
        {foot && <div className={styles.foot}>{foot}</div>}
      </div>
      {replies && <ul className={styles.replies}>{replies}</ul>}
    </li>
  );
}

// Render post events on the comment timeline without implying an authored comment.
export function ThreadEvent({ icon, note, children }: { icon: LucideIcon; note: string; children: ReactNode }) {
  return (
    <li className={styles.event}>
      <span className={styles.mark}>
        <Icon icon={icon} size="sm" />
      </span>
      <span className={styles.what}>{children}</span>
      <span className={styles.when}>{note}</span>
    </li>
  );
}
