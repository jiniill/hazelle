import styles from './Facts.module.css';
import { classNames } from '../foundation/classNames';
import { useLinks } from './link';

// notes: smaller lines under the value. links: what pointing at the item lights (link.tsx).
export type FactItem = { label: string; value: string; notes?: string[]; tone?: 'muted' | 'warn'; links?: string[] };

// tiles: on a panel's own ground, two to a line. row: all in one line, as a few periods compared; two to a line on a
// phone. figures: a row of counts on a page, the value leading.
export function Facts({ items, variant = 'plain' }: { items: FactItem[]; variant?: 'plain' | 'tiles' | 'row' | 'figures' }) {
  const scope = useLinks();
  return (
    <dl className={classNames(styles.facts, variant !== 'plain' && styles[variant])}>
      {items.map((item) => (
        <div
          key={item.label}
          className={classNames(styles.item, item.tone && styles[item.tone], item.links && styles.linked)}
          tabIndex={item.links ? 0 : undefined}
          {...(item.links ? scope.trigger(item.links) : {})}
        >
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
