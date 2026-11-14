import type { LucideIcon } from 'lucide-react';
import type { Ref } from 'react';
import { Icon } from '../foundation/Icon';
import { useShape } from '../foundation/theme';
import styles from './IconButton.module.css';
import { classNames } from '../foundation/classNames';

type Props = {
  icon: LucideIcon | string;
  label: string;
  title?: string;
  onClick: () => void;
  pressed?: boolean;
  current?: boolean;
  // A button that opens a menu takes popup, expanded and ref from Menu; one that shows and hides a panel takes
  // expanded alone.
  popup?: 'menu' | 'dialog';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  size?: 'sm' | 'md';
  disabled?: boolean;
  dot?: boolean;
  // How many wait behind it, such as unread alerts; shown from 1, and read out with the label.
  count?: number;
  // The rail's button: a frame around the icon, or in a labels rail no frame and its label under the icon.
  framed?: boolean;
};

// label is required: an icon-only button has no other accessible name.
export function IconButton({ icon, label, title = label, onClick, pressed, current, popup, expanded, ref, size = 'md', disabled = false, dot = false, count = 0, framed = false }: Props) {
  const labelled = useShape('rail') === 'labels' && framed;
  return (
    <button
      ref={ref}
      type="button"
      className={classNames(styles.button, size !== 'md' && styles[size], framed && (labelled ? styles.labelled : styles.framed))}
      aria-label={count > 0 ? `${label}, ${count}개` : label}
      title={title}
      aria-pressed={pressed}
      aria-current={current ? 'page' : undefined}
      aria-haspopup={popup}
      aria-expanded={expanded}
      disabled={disabled}
      onClick={onClick}
    >
      {typeof icon === 'string' ? (
        <span className={styles.glyph} aria-hidden>
          {icon}
        </span>
      ) : (
        <Icon icon={icon} size={size} />
      )}
      {labelled && (
        <span className={styles.caption} aria-hidden>
          {label}
        </span>
      )}
      {dot && <span className={styles.dot} aria-hidden />}
      {count > 0 && (
        <span className={styles.count} aria-hidden>
          {count}
        </span>
      )}
    </button>
  );
}
