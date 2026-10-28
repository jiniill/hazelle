import { Search } from 'lucide-react';
import { useId, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon } from '../foundation/Icon';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import styles from './SearchField.module.css';

// An API key may be pasted here, so the browser keeps no history of what was typed.
type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  // Takes the free width of a row it stands in, such as a header's title; a column stretches it already.
  grow?: boolean;
  after?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  ref?: Ref<HTMLInputElement>;
};

export function SearchField({ label, value, onChange, size = 'md', grow = false, after, onKeyDown, ref }: Props) {
  const id = useId();
  return (
    <div className={`${styles.field} ${size === 'sm' ? styles.sm : ''} ${grow ? styles.grow : ''}`}>
      <Icon icon={Search} size={size} />
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className={styles.input}
        type="search"
        {...NO_AUTOFILL}
        spellCheck={false}
        value={value}
        placeholder={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {after && <div className={styles.after}>{after}</div>}
    </div>
  );
}
