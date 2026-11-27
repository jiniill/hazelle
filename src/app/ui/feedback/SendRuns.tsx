import type { CSSProperties } from 'react';
import { classNames } from '../foundation/classNames';
import styles from './SendRuns.module.css';

// kept: read as forecast. broken: the request itself changed. missed: the request held and the provider read less.
// unread: nothing to judge it by.
export type SendRun = { state: 'kept' | 'broken' | 'missed' | 'unread'; share: number };

// The latest requests, oldest first, a bar each as tall as the share it read from the cache.
export function SendRuns({ label, runs, ends, legend }: { label: string; runs: SendRun[]; ends: [string, string]; legend: { state: 'broken' | 'missed'; label: string; value: string }[] }) {
  return (
    <div className={styles.sendRuns}>
      <div className={styles.runs} role="img" aria-label={label}>
        {runs.map((run, at) => (
          <span key={at} className={classNames(styles.run, run.state !== 'kept' && styles[run.state])}>
            <span className={styles.read} style={{ '--share': run.share } as CSSProperties} />
          </span>
        ))}
      </div>
      <div className={styles.ends} aria-hidden>
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
      <dl className={styles.legend}>
        {legend.map((item) => (
          <div key={item.state} className={styles.key}>
            <span className={classNames(styles.swatch, styles[item.state])} aria-hidden />
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// Which of the latest requests a thing happened on, oldest first, a cell each, and the count in words.
export function RunMarks({ on, note }: { on: boolean[]; note: string }) {
  return (
    <p className={styles.marks}>
      <span className={styles.cells} aria-hidden>
        {on.map((hit, at) => (
          <span key={at} className={classNames(styles.cell, hit && styles.hit)} />
        ))}
      </span>
      {note}
    </p>
  );
}
