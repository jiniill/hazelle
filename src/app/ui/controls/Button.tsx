import type { LucideIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode, type Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Button.module.css';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

// A slot that holds buttons decides their size, over what a caller passes: a screen's head, a section's head and a
// dialog's actions each read one size wherever they stand.
export const ButtonSlot = createContext<Size | null>(null);

type Props = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'link' | 'danger';
  size?: Size;
  type?: 'button' | 'submit';
  icon?: LucideIcon;
  // The name read out, when the text leans on the row around it; it must start with the text shown.
  label?: string;
  busy?: boolean;
  disabled?: boolean;
  popup?: 'menu' | 'dialog';
  expanded?: boolean;
  ref?: Ref<HTMLButtonElement>;
  onClick?: () => void;
  children: ReactNode;
};

export function Button({ variant = 'primary', size = 'lg', type = 'button', icon, label, busy = false, disabled = false, popup, expanded, ref, onClick, children }: Props) {
  const slot = useContext(ButtonSlot);
  const classes = [styles.button, styles[variant], styles[slot ?? size], busy && styles.busy].filter(Boolean).join(' ');
  return (
    <button
      ref={ref}
      className={classes}
      type={type}
      disabled={disabled || busy}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-haspopup={popup}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {icon && <Icon icon={icon} />}
      <span>{children}</span>
      {busy && <span className={styles.spinner} aria-hidden />}
    </button>
  );
}
