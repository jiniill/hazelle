import type { CSSProperties } from 'react';
import styles from './StepList.module.css';

// depth counts containing steps; branch is a condition verdict, warn means not executed.
export type StepRow = { source: string; result: string; depth: number; note?: string; tone?: 'branch' | 'warn' };

export function StepList({ label, steps, onPick }: { label: string; steps: StepRow[]; onPick: (index: number) => void }) {
  return (
    <ol className={styles.steps} aria-label={label}>
      {steps.map(({ source, result, depth, note, tone }, index) => (
        <li key={index}>
          <button type="button" className={tone ? `${styles.step} ${styles[tone]}` : styles.step} style={{ '--depth': depth } as CSSProperties} onClick={() => onPick(index)}>
            <code className={styles.source}>{source}</code>
            <span className={styles.arrow} aria-hidden>
              →
            </span>
            <code className={result ? styles.result : `${styles.result} ${styles.empty}`}>{result || '(없음)'}</code>
            {note && <span className={styles.sub}>{note}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}
