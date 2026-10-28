import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs } from '../collections/Tabs';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import type { CodeEditorProps } from './CodeEditor';
import type { Caret } from './codeLanguage';
import styles from './CodeEditor.module.css';

const CodeEditor = lazy(() => import('./CodeEditor'));

// A pane beside the code, behind a tab of its own on a narrow screen. reveal selects a range of the code and shows it.
export type CodeAside = { label: string; body: (reveal: (at: [number, number]) => void) => ReactNode };

// Keep the plain textarea usable during CodeMirror load; keep both tabs mounted to preserve caret/scroll.
export function CodeField(props: CodeEditorProps & { area: (element: HTMLTextAreaElement | null) => void; aside?: CodeAside }) {
  const { label, value, onChange, prose, area, aside, caret, ...rest } = props;
  const [asideShown, setAsideShown] = useState(false);
  const handle = useRef<Caret | null>(null);
  // caret is BigCopy's, which is stable; so is this one, since a new callback would be called again and put the caret back.
  const [own] = useState(() => (next: Caret | null) => {
    handle.current = next;
    caret?.(next);
  });
  // After the code tab shows: a hidden editor takes no focus.
  const [revealed, setRevealed] = useState<{ at: [number, number] } | null>(null);
  useEffect(() => {
    if (!revealed) return;
    handle.current?.focus();
    handle.current?.select(revealed.at);
  }, [revealed]);
  const reveal = (at: [number, number]) => {
    setAsideShown(false);
    setRevealed({ at });
  };
  const editor = (
    <Suspense fallback={<textarea ref={area} className={prose ? `${styles.loading} ${styles.prose}` : styles.loading} aria-label={label} data-autofocus {...NO_AUTOFILL} spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} />}>
      <CodeEditor label={label} value={value} onChange={onChange} prose={prose} caret={own} {...rest} />
    </Suspense>
  );
  if (!aside) return editor;
  return (
    <div className={asideShown ? `${styles.split} ${styles.asideShown}` : styles.split}>
      <div className={styles.tabs}>
        <Tabs
          label="보기"
          items={[
            { value: 'code', label: '코드' },
            { value: 'aside', label: aside.label },
          ]}
          value={asideShown ? 'aside' : 'code'}
          onChange={(value) => setAsideShown(value === 'aside')}
        />
      </div>
      <div className={styles.code}>{editor}</div>
      <section className={styles.aside} aria-label={aside.label}>
        {aside.body(reveal)}
      </section>
    </div>
  );
}
