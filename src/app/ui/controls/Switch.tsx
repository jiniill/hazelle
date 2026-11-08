import { createContext, useContext } from 'react';
import styles from './Switch.module.css';

// The id a setting row's label points at (SettingGroup).
export const RowSwitch = createContext<string | undefined>(undefined);

type Props = {
  label: string;
  checked: boolean;
  disabled?: boolean;
  // labeled: its words stand before it, where no row names it (a page head).
  variant?: 'bare' | 'labeled';
  onChange: (checked: boolean) => void;
};

// An on/off setting that takes effect at once, like a toggle; Checkbox is for a choice made before an action.
export function Switch({ label, checked, disabled = false, variant = 'bare', onChange }: Props) {
  const id = useContext(RowSwitch);
  const input = (
    <input
      id={id}
      className={styles.switch}
      type="checkbox"
      role="switch"
      aria-label={variant === 'bare' ? label : undefined}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
  if (variant === 'bare') return input;
  return (
    <label className={styles.labeled}>
      {label}
      {input}
    </label>
  );
}
