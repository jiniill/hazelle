import type { CSSProperties, ReactNode } from 'react';
import { classNames } from '../foundation/classNames';
import styles from './Compare.module.css';

// One measure as it stands and as a change would leave it, a bar each, with the acts that make the change under them.
// share: how much of the whole is kept; the rest shows as lost. better: the row the change improves.
export function Compare({ rows, children }: { rows: { label: string; share: number; value: string; better?: boolean }[]; children?: ReactNode }) {
  return (
    <div className={styles.compare}>
      <dl className={styles.rows}>
        {rows.map((row) => (
          <div key={row.label} className={styles.row}>
            <dt>{row.label}</dt>
            <span className={styles.track} aria-hidden>
              <span className={styles.fill} style={{ '--share': row.share } as CSSProperties} />
            </span>
            <dd className={classNames(row.better && styles.better)}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}
