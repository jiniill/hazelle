import { useRef } from 'react';
import { ChartTip } from './ChartTip';
import { linkState, useLinks } from './link';
import styles from './WeekBars.module.css';

type WeekDay = { value: number; label: string; title: string; note: string; keys: string[]; links: string[]; current?: boolean };

// current: the day the week is shown for, in the accent.
export function WeekBars({ label, days }: { label: string; days: WeekDay[] }) {
  const links = useLinks();
  const frame = useRef<HTMLDivElement>(null);
  const most = Math.max(1, ...days.map((day) => day.value));
  return (
    <div ref={frame} className={styles.week}>
      <div className={styles.bars} role="img" aria-label={label}>
        {days.map((day, at) => (
          <span key={at} className={styles.column} {...links.trigger(day.links, day)}>
            <span className={styles.bar} style={{ height: `${(day.value / most) * 100}%` }} data-current={day.current || undefined} data-link={linkState(links.active, day.keys) ?? undefined} />
          </span>
        ))}
      </div>
      <div className={styles.labels} aria-hidden>
        {days.map((day, at) => (
          <span key={at}>{day.label}</span>
        ))}
      </div>
      <ChartTip pointed={links.pointed} frame={frame} />
    </div>
  );
}
