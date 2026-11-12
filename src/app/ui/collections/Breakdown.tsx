import { linkState, useOwnLinks } from './link';
import styles from './Breakdown.module.css';

type Part = { label: string; value: string; mark: 'accent' | 'striped' | 'plain' | 'outline' };

// A part pointed at, in the bar or the legend, lights in both; the others dim.
export function Breakdown({ parts, shares, total }: { parts: Part[]; shares: number[] | null; total?: { label: string; value: string } }) {
  const links = useOwnLinks();
  const link = (index: number) => {
    const key = `part:${index}`;
    return { 'data-link': linkState(links.active, [key]) ?? undefined, ...links.trigger([key]) };
  };
  return (
    <div className={styles.breakdown}>
      {total && (
        <p className={styles.total}>
          <span className={styles.totalLabel}>{total.label}</span>
          <span className={styles.totalValue}>{total.value}</span>
        </p>
      )}
      {shares && (
        <div className={styles.bar} aria-hidden>
          {shares.map((share, index) => (
            <span key={index} className={`${styles.segment} ${styles[parts[index]!.mark]}`} style={{ width: `${share * 100}%` }} {...link(index)} />
          ))}
        </div>
      )}
      <dl className={styles.legend}>
        {parts.map((part, index) => (
          <div key={part.label} className={styles.row} tabIndex={0} {...link(index)}>
            <span className={`${styles.swatch} ${styles[part.mark]}`} />
            <dt className={styles.label}>{part.label}</dt>
            <dd className={styles.value}>{part.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
