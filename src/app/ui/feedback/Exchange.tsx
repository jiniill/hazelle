import type { ReactNode } from 'react';
import styles from './Exchange.module.css';

// One ask to a model and its answer, as the plugin studio's AI pane keeps them: the ask in a bubble at the end, the
// answer's words under it, then what it brought (a change to keep or drop) and a foot line (the model and its cost).
export function Exchange({ ask, answer, foot, children }: { ask: string; answer?: ReactNode; foot?: string; children?: ReactNode }) {
  return (
    <div className={styles.exchange}>
      <p className={styles.ask}>{ask}</p>
      {answer && <p className={styles.answer}>{answer}</p>}
      {children}
      {foot && <p className={styles.detail}>{foot}</p>}
    </div>
  );
}
