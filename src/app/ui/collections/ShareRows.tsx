import type { CSSProperties } from 'react';
import { classNames } from '../foundation/classNames';
import styles from './ShareRows.module.css';

export type ShareRow = { key: string; name: string; note?: string; kept: number; amount: string; rate: string };

// Things that each kept a share of a whole and lost the rest, a row each: its bar, how much it lost and at what rate.
// columns: what the name, the bar, the amount and the rate are. lost: whose the rest is, 'broken' in the fault's
// colour, 'missed' an empty stretch nobody here is at fault for. kept: 0 to 1.
export function ShareRows({ label, columns, lost, rows }: { label: string; columns: [string, string, string, string]; lost: 'broken' | 'missed'; rows: ShareRow[] }) {
  return (
    <div className={classNames(styles.shareRows, lost === 'missed' && styles.missed)}>
      <div className={styles.head} aria-hidden>
        <span>{columns[0]}</span>
        <span>{columns[1]}</span>
        <span className={styles.end}>{columns[2]}</span>
        <span className={styles.end}>{columns[3]}</span>
      </div>
      <ul className={styles.rows} aria-label={label}>
        {rows.map((row) => (
          <li key={row.key} className={styles.row}>
            <span className={styles.names}>
              <span className={styles.name}>{row.name}</span>
              {row.note && <span className={styles.note}>{row.note}</span>}
            </span>
            <span className={styles.track} aria-hidden>
              <span className={styles.fill} style={{ '--share': row.kept } as CSSProperties} />
            </span>
            <span className={styles.amount}>
              <span className={styles.label}>{columns[2]} </span>
              {row.amount}
            </span>
            <span className={styles.rate}>
              <span className={styles.label}>{columns[3]} </span>
              {row.rate}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
