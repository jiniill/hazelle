import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import styles from './TourCard.module.css';

export function TourCard({ icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action: ReactNode }) {
  return (
    <div className={styles.card}>
      <Tag tone="accent" icon={icon} />
      <span className={styles.words}>
        <span className={styles.title}>{title}</span>
        <span className={styles.sub}>{description}</span>
      </span>
      {action}
    </div>
  );
}
