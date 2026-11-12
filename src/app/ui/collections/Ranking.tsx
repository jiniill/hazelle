import { Avatar } from '../foundation/Avatar';
import { Hint, type Help } from '../overlays/Hint';
import styles from './Ranking.module.css';
import { classNames } from '../foundation/classNames';

// rank null is an unranked trailing pool. share scales to the largest row; move.label replaces move.text for speech.
// face: drawn with Avatar, a name standing in as its first letter.
export type Ranked = {
  key: string;
  rank: number | null;
  name: string;
  note: string;
  value: string;
  share: number;
  move?: { tone: 'up' | 'down' | 'new'; text: string; label: string };
  help?: Help;
  face?: { face: string; image?: string };
};

const PLACES: Record<number, string> = { 1: styles.first, 2: styles.second, 3: styles.third };

// podium: the first three stand as cards, the first in the middle, and the rest follow as rows.
export function Ranking({ label, items, variant = 'list' }: { label: string; items: Ranked[]; variant?: 'list' | 'podium' }) {
  if (variant === 'list') return <Rows label={label} items={items} />;
  const stands = items.filter((item) => item.rank !== null && item.rank <= 3);
  return (
    <div className={styles.podiumRanking} role="group" aria-label={label}>
      <ol className={styles.podium}>
        {stands.map((item) => (
          <li key={item.key} className={classNames(styles.stand, PLACES[item.rank!])}>
            <span className={styles.ring}>
              <Avatar face={item.face?.face ?? item.name} image={item.face?.image} size={item.rank === 1 ? 'lg' : 'rail'} />
              <span className={styles.badge}>{item.rank}</span>
            </span>
            <span className={styles.standName}>{item.name}</span>
            <span className={styles.detail}>{item.note}</span>
            <span className={styles.standValue}>{item.value}</span>
          </li>
        ))}
      </ol>
      {items.length > stands.length && <Rows items={items.slice(stands.length)} />}
    </div>
  );
}

function Rows({ label, items }: { label?: string; items: Ranked[] }) {
  return (
    <ol className={classNames(styles.ranking, items.some((item) => item.face) && styles.faced)} aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className={classNames(styles.row, item.rank === null ? '' : PLACES[item.rank])}>
          <span className={styles.standing}>
            <span className={styles.place}>{item.rank ?? '–'}</span>
            {item.move && (
              <span className={[styles.move, styles[item.move.tone]].join(' ')}>
                <span aria-hidden>{item.move.text}</span>
                <span className={styles.hidden}>{item.move.label}</span>
              </span>
            )}
          </span>
          {item.face && (
            <span className={styles.face}>
              <Avatar face={item.face.face} image={item.face.image} />
            </span>
          )}
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
