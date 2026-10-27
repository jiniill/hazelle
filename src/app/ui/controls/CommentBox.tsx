import { useId, useRef, type ReactNode } from 'react';
import styles from './CommentBox.module.css';
import { useAutosize } from './useAutosize';

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  // A count against its limit, at the foot's start; error takes its place.
  hint?: string;
  error?: string;
  // Buttons at the foot's end, such as 취소 and 등록.
  actions: ReactNode;
  // Takes the caret when it opens, as a 답글 or an edit does.
  focus?: boolean;
};

// A comment written in place: the text grows with what is typed, its buttons inside the box.
export function CommentBox({ label, value, onChange, placeholder, hint, error, actions, focus = false }: Props) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  useAutosize(area, value);
  const note = error ?? hint;
  return (
    <div className={styles.box} data-invalid={error ? true : undefined}>
      <textarea
        ref={area}
        className={styles.input}
        autoComplete="off"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? id : undefined}
        placeholder={placeholder}
        value={value}
        autoFocus={focus}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className={styles.foot}>
        <span id={id} className={error ? `${styles.note} ${styles.error}` : styles.note}>
          {note}
        </span>
        <span className={styles.actions}>{actions}</span>
      </div>
    </div>
  );
}
