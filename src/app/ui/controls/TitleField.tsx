import { useState, type Ref } from 'react';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import styles from './TitleField.module.css';

type Props = {
  label: string;
  value: string;
  placeholder: string;
  // What a blank means where it is a value, as NameDialog's blank: it lets the blank through, and the placeholder names
  // what stands in for it.
  blank?: string;
  onChange: (value: string) => void;
  // The head it renames: a page's title, or a one-line head with a subtitle under it; else a title inside a pane.
  place?: 'page' | 'line';
  ref?: Ref<HTMLInputElement>;
};

// Without blank, never emit empty names; restore value on blur (user ruling).
// Keep focused draft text untouched by caller trimming to avoid moving the caret.
export function TitleField({ label, value, placeholder, blank, onChange, place, ref }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      ref={ref}
      className={place ? `${styles.field} ${styles[place]}` : styles.field}
      aria-label={label}
      value={draft ?? value}
      placeholder={placeholder}
      title={blank}
      {...NO_AUTOFILL}
      spellCheck={false}
      onFocus={() => setDraft(value)}
      onBlur={() => setDraft(null)}
      onChange={(event) => {
        setDraft(event.target.value);
        if (blank !== undefined || event.target.value.trim()) onChange(event.target.value);
      }}
    />
  );
}
