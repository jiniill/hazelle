import type { CSSProperties } from 'react';
import styles from './StepList.module.css';

// depth counts containing steps; branch is a condition verdict, warn means not executed.
export type StepRow = { source: string; result: string; depth: number; note?: string; tone?: 'branch' | 'warn' };

// onPick: absent where a step has no source to show, so its rows are only read.
export function StepList({ label, steps, onPick }: { label: string; steps: StepRow[]; onPick?: (index: number) => void }) {
  return (
    <ol className={styles.steps} aria-label={label}>
      {steps.map(({ source, result, depth, note, tone }, index) => {
        const look = [styles.step, onPick && styles.pick, tone && styles[tone]].filter(Boolean).join(' ');
        const depthOf = { '--depth': depth } as CSSProperties;
        const row = (
          <>
            <code className={styles.source}>{source}</code>
            <span className={styles.arrow} aria-hidden>
              →
            </span>
            <code className={result ? styles.result : `${styles.result} ${styles.empty}`}>{result || '(없음)'}</code>
            {note && <span className={styles.sub}>{note}</span>}
          </>
        );
        return (
          <li key={index}>
            {onPick ? <button type="button" className={look} style={depthOf} onClick={() => onPick(index)}>{row}</button> : <div className={look} style={depthOf}>{row}</div>}
          </li>
        );
      })}
    </ol>
  );
}
