import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs } from '../collections/Tabs';
import { NO_AUTOFILL } from '../foundation/noAutofill';
import type { CodeEditorProps } from './CodeEditor';
import type { Caret } from './codeLanguage';
import styles from './CodeEditor.module.css';

const CodeEditor = lazy(() => import('./CodeEditor'));

// A pane beside the code, behind a tab of its own on a narrow screen. reveal selects a range of the code and shows it;
// show brings up the pane of that label.
export type CodeAside = { label: string; body: (reveal: (at: [number, number]) => void, show: (label: string) => void) => ReactNode };

// Keep the plain textarea usable during CodeMirror load; keep every tab mounted to preserve caret/scroll. asides: the
// panes beside the code, one shown at a time; narrow, the code is one more tab before them.
export function CodeField(props: CodeEditorProps & { area: (element: HTMLTextAreaElement | null) => void; asides?: readonly CodeAside[] }) {
  const { label, value, onChange, prose, area, asides, caret, ...rest } = props;
  const [pane, setPane] = useState(0);
  const [codeShown, setCodeShown] = useState(true);
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
    setCodeShown(true);
    setRevealed({ at });
  };
  const show = (label: string) => {
    const index = asides?.findIndex((aside) => aside.label === label) ?? -1;
    if (index < 0) return;
    setPane(index);
    setCodeShown(false);
  };
  const editor = (
    <Suspense fallback={<textarea ref={area} className={prose ? `${styles.loading} ${styles.prose}` : styles.loading} aria-label={label} data-autofocus {...NO_AUTOFILL} spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} />}>
      <CodeEditor label={label} value={value} onChange={onChange} prose={prose} caret={own} {...rest} />
    </Suspense>
  );
  if (!asides?.length) return editor;
  const panes = asides.map((aside, index) => ({ value: String(index), label: aside.label }));
  return (
    <div className={codeShown ? styles.split : `${styles.split} ${styles.asideShown}`}>
      <div className={styles.tabs}>
        <Tabs
          label="보기"
          items={[{ value: 'code', label: '코드' }, ...panes]}
          value={codeShown ? 'code' : String(pane)}
          onChange={(value) => {
            setCodeShown(value === 'code');
            if (value !== 'code') setPane(Number(value));
          }}
        />
      </div>
      <div className={styles.code}>{editor}</div>
      <div className={styles.asides}>
        {panes.length > 1 && (
          <div className={styles.asideTabs}>
            <Tabs label="보기" items={panes} value={String(pane)} onChange={(value) => setPane(Number(value))} />
          </div>
        )}
        {asides.map((aside, index) => (
          <section key={aside.label} className={styles.aside} hidden={index !== pane} aria-label={aside.label}>
            {aside.body(reveal, show)}
          </section>
        ))}
      </div>
    </div>
  );
}
