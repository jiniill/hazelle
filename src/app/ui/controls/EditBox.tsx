import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import styles from './EditBox.module.css';
import { useAutosize } from './useAutosize';

type Field = { label: string; value: string; onChange: (value: string) => void };
type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  second?: Field & { firstLabel: string };
  // Where the caret starts, the end when absent; read once, as the box opens.
  caret?: number;
};

export function EditBox({ value, onChange, onKeyDown, second, caret }: Props) {
  return (
    <div className={styles.box}>
      <Area label={second?.firstLabel ?? '메시지 수정'} shown={second !== undefined} value={value} onChange={onChange} onKeyDown={onKeyDown} focus caret={caret} />
      {second && <Area label={second.label} shown value={second.value} onChange={second.onChange} onKeyDown={onKeyDown} focus={false} />}

    </div>
  );
}

function Area({ label, shown, value, onChange, onKeyDown, focus, caret }: Field & { shown: boolean; onKeyDown: Props['onKeyDown']; focus: boolean; caret?: number }) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focus) return;
    const element = area.current!;
    const at = caret ?? element.value.length;
    element.focus();
    element.setSelectionRange(at, at);
  }, [focus]);
  useAutosize(area, value);
  return (
    <>
      <label className={shown ? styles.fieldLabel : styles.label} htmlFor={id}>
        {label}
      </label>
      <textarea id={id} ref={area} className={styles.input} {...NO_AUTOFILL} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
    </>
  );
}
