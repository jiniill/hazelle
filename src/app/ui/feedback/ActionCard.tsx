import type { LucideIcon } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import styles from './ActionCard.module.css';
import { classNames } from '../foundation/classNames';

type Props = {
  tone?: 'plain' | 'accent';
  size?: 'md' | 'sm';
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
};

export function ActionCard({ tone = 'plain', size = 'md', icon, title, description, onClick }: Props) {
  return (
    <button type="button" className={classNames(styles.card, tone === 'accent' && styles.accent, size === 'sm' && styles.sm)} onClick={onClick}>
      <span className={styles.icon}>
        <Icon icon={icon} />
      </span>
      <span className={styles.title}>{title}</span>
      <span className={styles.description}>{description}</span>
    </button>
  );
}
