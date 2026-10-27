import { Hint, type Help } from '../overlays/Hint';
import styles from './Ranking.module.css';

// rank null is an unranked trailing pool. share scales to the largest row; move.label replaces move.text for speech.
export type Ranked = {
  key: string;
  rank: number | null;
  name: string;
  note: string;
  value: string;
  share: number;
  move?: { tone: 'up' | 'down' | 'new'; text: string; label: string };
  help?: Help;
};

const PLACES: Record<number, string> = { 1: styles.first, 2: styles.second, 3: styles.third };

export function Ranking({ label, items }: { label: string; items: Ranked[] }) {
  return (
    <ol className={styles.ranking} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={[styles.row, item.rank === null ? '' : PLACES[item.rank]].filter(Boolean).join(' ')}>
          <span className={styles.standing}>
            <span className={styles.place}>{item.rank ?? '–'}</span>
            {item.move && (
              <span className={[styles.move, styles[item.move.tone]].join(' ')}>
                <span aria-hidden>{item.move.text}</span>
                <span className={styles.hidden}>{item.move.label}</span>
              </span>
            )}
          </span>
          <div className={styles.body}>
            <span className={styles.title}>
              <span className={styles.name}>{item.name}</span>
              {item.help && <Hint label={item.name}>{item.help}</Hint>}
            </span>
            <span className={styles.detail}>{item.note}</span>
            <span className={styles.track} aria-hidden>
              <span className={styles.fill} style={{ width: `${item.share * 100}%` }} />
            </span>
          </div>
          <span className={styles.value}>{item.value}</span>
        </li>
      ))}
    </ol>
  );
}
