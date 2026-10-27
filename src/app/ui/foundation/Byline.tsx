import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Avatar } from './Avatar';
import styles from './Byline.module.css';

type Props = {
  name: string;
  // An icon in place of the name's first letter, such as one for an account that left.
  face?: LucideIcon;
  // accent: the operator, whose face and name take the accent.
  tone?: 'plain' | 'accent';
  marks?: ReactNode;
  // When, after the name on one line (sm) or under it (md).
  note?: ReactNode;
  size?: 'sm' | 'md';
};

export function Byline({ name, face, tone = 'plain', marks, note, size = 'sm' }: Props) {
  return (
    <span className={`${styles.byline} ${styles[size]}`}>
      <Avatar face={face ?? name} size={size} tone={tone === 'accent' ? 'accent' : 'plain'} />
      <span className={styles.text}>
        <span className={styles.who}>
          <span className={tone === 'accent' ? `${styles.name} ${styles.accent}` : styles.name}>{name}</span>
          {marks}
        </span>
        {note && <span className={styles.note}>{note}</span>}
      </span>
    </span>
  );
}
