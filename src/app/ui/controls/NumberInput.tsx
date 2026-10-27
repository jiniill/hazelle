import styles from './NumberInput.module.css';

// Empty can mean inherited value; placeholderTone value styles a real effective number, not a hint.
type Props = { label: string; value: string; onChange: (value: string) => void; invalid?: boolean; unit?: string; placeholder?: string; placeholderTone?: 'hint' | 'value' };

export function NumberInput({ label, value, onChange, invalid = false, unit, placeholder, placeholderTone = 'hint' }: Props) {
  return (
    <span className={styles.box}>
      <input
        className={placeholderTone === 'value' ? `${styles.input} ${styles.value}` : styles.input}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {unit && <span className={styles.unit}>{unit}</span>}
    </span>
  );
}
