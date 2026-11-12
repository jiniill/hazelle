import type { ReactNode } from 'react';
import { useLinks } from '../collections/link';
import styles from './Moment.module.css';

// children: the drawing at the card's end (HourDial, WeekBars). links: what pointing at the card lights.
export function Moment({ label, value, note, links, children }: { label: string; value: ReactNode; note?: string; links?: string[]; children?: ReactNode }) {
  const scope = useLinks();
  return (
    <div className={styles.moment} tabIndex={links ? 0 : undefined} {...(links ? scope.trigger(links) : {})}>
      <div className={styles.words}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value}>{value}</span>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      {children}
    </div>
  );
}
