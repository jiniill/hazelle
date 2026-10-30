import { useId, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import styles from './Composer.module.css';
import { useAutosize } from './useAutosize';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  tools?: ReactNode;
  actions: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  compact: boolean;
  readOnly?: boolean;
  enterKeyHint?: 'send' | 'enter';
  // attachments: what the message carries, above its text (Attachments). onFiles: files pasted with no text.
  attachments?: ReactNode;
  onFiles?: (files: File[]) => void;
};

export function Composer({ value, onChange, onKeyDown, placeholder, tools, actions, inputRef, compact, readOnly, enterKeyHint, attachments, onFiles }: Props) {
  const id = useId();
  useAutosize(inputRef, value);
  return (
    <div className={`${styles.composer} ${compact ? styles.compact : ''}`}>
      <label className={styles.label} htmlFor={id}>
        메시지
      </label>
      {attachments}
      <textarea
        id={id}
        ref={inputRef}
        className={styles.input}
        rows={2}
        {...NO_AUTOFILL}
        value={value}
        readOnly={readOnly}
        enterKeyHint={enterKeyHint}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onFiles && ((event: ClipboardEvent<HTMLTextAreaElement>) => {
          const files = [...event.clipboardData.files];
          // Office apps copy a picture of the text beside it, and the text is what was meant.
          if (!files.length || event.clipboardData.getData('text/plain')) return;
          event.preventDefault();
          onFiles(files);
        })}
      />
      <div className={styles.fold}>
        <div className={styles.tools}>
          <div className={styles.bar}>
            <div className={styles.toolRow}>{tools}</div>
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
