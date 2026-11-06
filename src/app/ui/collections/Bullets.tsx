import styles from './Bullets.module.css';

// Things in no order, such as what to have ready.
export function Bullets({ items }: { items: string[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item} className={styles.item}>
          <span className={styles.dot} aria-hidden />
          {item}
        </li>
      ))}
    </ul>
  );
}
