import type { ReactNode } from 'react';
import styles from './HowTo.module.css';

export type HowToStep = { key: string; content: ReactNode; note?: ReactNode; figure?: ReactNode };

// Steps to follow in order, joined by a line, each with a quiet note or a picture under it.
export function HowTo({ steps }: { steps: HowToStep[] }) {
  return (
    <ol className={styles.steps}>
      {steps.map((step, index) => (
        <li key={step.key} className={styles.step}>
          {/* The list already numbers its items for a reader. */}
          <span className={styles.number} aria-hidden>
            {index + 1}
          </span>
          <div className={styles.body}>
            <p className={styles.text}>{step.content}</p>
            {step.note && <p className={styles.note}>{step.note}</p>}
            {step.figure}
          </div>
        </li>
      ))}
    </ol>
  );
}
