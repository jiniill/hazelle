import { useId, type ChangeEvent, type ReactNode } from 'react';
import type { Chord } from '../foundation/keys';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import { Hint, type Help } from '../overlays/Hint';
import type { CodeLanguage } from './codeLanguage';
import { CodeField, type CodeAside } from './CodeField';
import { pasteFiles } from './pasteFiles';
import styles from './TextField.module.css';
import { useBigEdit } from './useBigEdit';

const KINDS = {
  text: { type: 'text', ...NO_AUTOFILL },
  username: { type: 'text', autoComplete: 'username', autoCapitalize: 'none', spellCheck: false },
  code: { type: 'text', ...NO_AUTOFILL, autoCapitalize: 'characters', spellCheck: false },
  // API keys, addresses and a script's code: shown as typed, in the mono face, never saved by the browser.
  key: { type: 'text', ...NO_AUTOFILL, autoCapitalize: 'none', spellCheck: false },
  'new-password': { type: 'password', autoComplete: 'new-password' },
  'current-password': { type: 'password', autoComplete: 'current-password' },
} as const;

type Props = {
  label: string;
  showLabel?: boolean;
  kind?: keyof typeof KINDS;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  // A short measure of the text, by the label and in its big editor.
  count?: string;
  help?: Help;
  error?: string;
  lines?: number;
  readOnly?: boolean;
  action?: ReactNode;
  // A text area's keys for its big editor, which a button by its label opens too.
  expand?: readonly Chord[];
  // The language the text is written in: its big editor is the code editor, in code type for a key field.
  language?: CodeLanguage;
  // A pane beside that editor, given the text as it stands.
  aside?: (text: string) => CodeAside;
  // A text area's files pasted with no text.
  onFiles?: (files: File[]) => void;
};

export function TextField({ label, showLabel = true, kind = 'text', value, onChange, placeholder, hint, count, help, error, lines, readOnly, action, expand, language, aside, onFiles }: Props) {
  const id = useId();
  const noteId = `${id}-note`;
  const note = error ?? hint;
  const { type, ...typed } = KINDS[kind];
  const look = kind === 'key' ? `${styles.input} ${styles.mono}` : styles.input;
  const shared = {
    value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    placeholder,
    readOnly,
    'aria-invalid': error ? true : undefined,
  };
  const big = useBigEdit(expand, label, (copy) =>
    language ? <CodeField label={label} value={value} onChange={onChange} language={language} prose={kind !== 'key'} area={copy.area} caret={copy.caret} asides={aside && [aside(value)]} /> : <textarea ref={copy.area} className={`${look} ${styles.big}`} aria-label={label} data-autofocus {...typed} {...shared} />,
  count);
  const own = { id, 'aria-label': showLabel ? undefined : label, 'aria-describedby': note ? noteId : undefined, ...shared };
  return (
    <>
      <div className={styles.field} {...big.wrap}>
        {showLabel && <div className={styles.head}>
          <span className={styles.name}>
            <label className={styles.label} htmlFor={id}>
              {label}
            </label>
            {help && <Hint label={label}>{help}</Hint>}
          </span>
          {count && <span className={styles.hint}>{count}</span>}
          {action}
          {big.button}
        </div>}
        {lines ? (
          <textarea className={`${look} ${styles.area}`} rows={lines} {...typed} {...own} onPaste={onFiles && ((event) => pasteFiles(event, onFiles))} />
        ) : (
          <input className={look} type={type} {...typed} {...own} />
        )}
        {note && (
          <p id={noteId} className={error ? styles.error : styles.hint}>
            {note}
          </p>
        )}
      </div>
      {big.dialog}
    </>
  );
}
