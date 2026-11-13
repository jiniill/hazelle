import { createContext, useId, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import styles from './Composer.module.css';
import { pasteFiles } from './pasteFiles';
import { useAutosize } from './useAutosize';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  tools?: ReactNode;
  actions: ReactNode;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  // compact: folded, whatever has the focus; onOpen: a press, a focus or a key in it asks it open.
  compact: boolean;
  onOpen: () => void;
  readOnly?: boolean;
  enterKeyHint?: 'send' | 'enter';
  // attachments: what the message carries, above its text (Attachments). onFiles: files pasted with no text.
  attachments?: ReactNode;
  onFiles?: (files: File[]) => void;
};

// Read by SendButton, which gives the focus back to it.
export const ComposerField = createContext<RefObject<HTMLTextAreaElement | null>>({ current: null });

export function Composer({ value, onChange, onKeyDown, placeholder, tools, actions, inputRef, compact, onOpen, readOnly, enterKeyHint, attachments, onFiles }: Props) {
  const id = useId();
  useAutosize(inputRef, value);
  return (
    <div
      className={`${styles.composer} ${compact ? styles.compact : ''}`}
      // A press on the box's own edge, around the text, is a press on the text. Folded while it is written in, a press
      // anywhere opens it with the caret where it was, which a press on the one line shown would move.
      onMouseDown={(event) => {
        const input = inputRef.current!;
        if (event.target !== event.currentTarget && !(compact && document.activeElement === input)) return;
        event.preventDefault();
        input.focus();
        onOpen();
      }}
      onFocus={onOpen}
    >
      <label className={styles.label} htmlFor={id}>
        메시지
      </label>
      {attachments}
      <div className={styles.field}>
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
          onChange={(event) => {
            onChange(event.target.value);
            onOpen();
          }}
          onKeyDown={onKeyDown}
          onPaste={onFiles && ((event) => pasteFiles(event.nativeEvent, onFiles))}
        />
        <span className={styles.peek} aria-hidden>
          {value}
        </span>
      </div>
      <div className={styles.fold}>
        <div className={styles.tools}>
          <div className={styles.bar}>
            <div className={styles.toolRow}>{tools}</div>
            <div className={styles.actions}>
              <ComposerField.Provider value={inputRef}>{actions}</ComposerField.Provider>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
