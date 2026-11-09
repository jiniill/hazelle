import styles from './Facts.module.css';
import { classNames } from '../foundation/classNames';

// notes: smaller lines under the value.
export type FactItem = { label: string; value: string; notes?: string[]; tone?: 'muted' | 'warn' };

// tiles: on a panel's own ground, two to a line. row: all in one line, as a few periods compared; two to a line on a
// phone. figures: a row of counts on a page, the value leading.
export function Facts({ items, variant = 'plain' }: { items: FactItem[]; variant?: 'plain' | 'tiles' | 'row' | 'figures' }) {
  return (
    <dl className={classNames(styles.facts, variant !== 'plain' && styles[variant])}>
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `${styles.item} ${styles[item.tone]}` : styles.item}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={styles.value}>{item.value}</dd>
          {item.notes?.map((line) => (
            <dd key={line} className={styles.detail}>
              {line}
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );
}
