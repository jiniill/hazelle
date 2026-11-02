import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './ActionCard.module.css';

type Props = {
  tone?: 'plain' | 'accent';
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
};

export function ActionCard({ tone = 'plain', icon, title, description, onClick }: Props) {
  return (
    <button type="button" className={tone === 'accent' ? `${styles.card} ${styles.accent}` : styles.card} onClick={onClick}>
      <span className={styles.icon}>
        <Icon icon={icon} />
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.description}>{description}</span>
    </button>
  );
}
