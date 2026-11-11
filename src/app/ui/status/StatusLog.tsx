import styles from './StatusLog.module.css';

type Props = { name: string; columns: { id: string; name: string }[]; rows: string[][] };

// A 기록's rows, newest last: the first field leads each line and the rest follow it, quieter; a 기록 of one field
// reads as a list.
export function StatusLog({ name, columns, rows }: Props) {
  return (
    <section className={styles.log} aria-label={name}>
      <h4 className={styles.title}>{name}</h4>
      <ul className={styles.rows}>
        {rows.map((cells, index) => (
          <li key={index} className={columns.length > 1 ? styles.row : styles.line}>
            {cells.map((cell, at) => (
              <span key={columns[at]?.id ?? at} className={at === 0 ? styles.lead : styles.cell} title={at === 0 ? undefined : columns[at]?.name}>
                {cell}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
