import styles from './Shares.module.css';

type Share = { key: string; label: string; value: string; share: number };

export function Shares({ items }: { items: Share[] }) {
  return (
    <ul className={styles.shares}>
      {items.map((item) => (
        <li key={item.key} className={styles.row}>
          <div className={styles.line}>
            <span className={styles.label}>{item.label}</span>
            <span className={styles.value}>{item.value}</span>
          </div>
          <span className={styles.track} aria-hidden>
            <span className={styles.fill} style={{ width: `${item.share * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
