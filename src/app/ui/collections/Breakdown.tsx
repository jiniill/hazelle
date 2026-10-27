import styles from './Breakdown.module.css';

type Part = { label: string; value: string; mark: 'accent' | 'striped' | 'plain' | 'outline' };

export function Breakdown({ parts, shares, total }: { parts: Part[]; shares: number[] | null; total?: { label: string; value: string } }) {
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
            <span key={index} className={styles[parts[index]!.mark]} style={{ width: `${share * 100}%` }} />
          ))}
        </div>
      )}
      <dl className={styles.legend}>
        {parts.map((part) => (
          <div key={part.label} className={styles.row}>
            <span className={`${styles.swatch} ${styles[part.mark]}`} />
            <dt className={styles.label}>{part.label}</dt>
            <dd className={styles.value}>{part.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
