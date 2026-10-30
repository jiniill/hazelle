import { createContext, useContext } from 'react';
import styles from './Switch.module.css';

// The id a setting row's label points at (SettingGroup).
export const RowSwitch = createContext<string | undefined>(undefined);

// An on/off setting that takes effect at once, like a toggle; Checkbox is for a choice made before an action.
export function Switch({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const id = useContext(RowSwitch);
  return (
    <input
      id={id}
      className={styles.switch}
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
