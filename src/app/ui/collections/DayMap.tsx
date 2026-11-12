import { useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { classNames } from '../foundation/classNames';
import { ChartTip } from './ChartTip';
import { RAMP, Scale } from './Scale';
import { linkState, useLinks, useOwnLinks } from './link';
import type { Level } from './levels';
import styles from './DayMap.module.css';

// level null: a day still to come.
export type DayCell = { level: Level | null; title: string; note: string; keys: string[]; today?: boolean };

const NONE: string[] = [];
const MONTH = new Intl.DateTimeFormat('ko-KR', { month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('ko-KR', { weekday: 'narrow' });
// 2024-01-01 was a Monday.
const WEEKDAYS = Array.from({ length: 7 }, (_, day) => WEEKDAY.format(new Date(2024, 0, 1 + day)));

// By the calendar, not by 24 hours, so a day that changes the clock still lands on its own date.
const dateAt = (start: number, index: number) => {
  const date = new Date(start);
  date.setDate(date.getDate() + index);
  return date;
};

// Monday first: each day's date, the blank days before the first one, and the week column each month's first day opens.
export function weeks(start: number, count: number) {
  const dates = Array.from({ length: count }, (_, index) => dateAt(start, index));
  const lead = (new Date(start).getDay() + 6) % 7;
  const months = dates.flatMap((date, index) => (date.getDate() === 1 ? [{ column: Math.floor((lead + index) / 7), first: index }] : []));
  return { dates, lead, columns: Math.ceil((lead + count) / 7), months };
}

const monthOf = (date: Date) => `month:${date.getFullYear()}-${date.getMonth()}`;

// The period's key changes the map's key, so a new period lights in again.
export function DayMap({ label, layout, start, days, note, scale }: { label: string; layout: 'year' | 'month'; start: number; days: DayCell[]; note?: string; scale: { low: string; high: string } }) {
  const page = useLinks();
  const months = useOwnLinks();
  const frame = useRef<HTMLElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const grid = useMemo(() => weeks(start, days.length), [start, days.length]);
  const { dates } = grid;
  // The latest weeks first in view where the strip scrolls.
  useLayoutEffect(() => {
    if (strip.current) strip.current.scrollLeft = strip.current.scrollWidth;
  }, []);

  const blanks = Array.from({ length: grid.lead }, (_, index) => <span key={`blank${index}`} />);
  const cells = days.map((day, index) => {
    const date = dates[index]!;
    const state = linkState(months.active, [monthOf(date)]) ?? linkState(page.active, day.keys);
    return (
      <span
        key={index}
        className={day.level === null ? `${styles.day} ${styles.future}` : classNames(styles.day, RAMP[day.level], styles.past, day.level >= 3 && styles.strong, day.level === 4 && styles.glow)}
        data-link={state ?? undefined}
        data-today={day.today || undefined}
        style={{ '--order': index / days.length } as CSSProperties}
        {...(day.level === null ? {} : page.trigger(NONE, day))}
      >
        {layout === 'month' && date.getDate()}
      </span>
    );
  });

  return (
    <figure ref={frame} className={styles.map}>
      {layout === 'year' ? (
        <div ref={strip} className={styles.strip}>
          <div className={styles.year} style={{ '--weeks': grid.columns } as CSSProperties}>
            <div className={styles.months}>
              {grid.months.map(({ column, first }) => {
                const key = monthOf(dates[first]!);
                return (
                  <span key={key} className={styles.month} style={{ gridColumn: column + 1 }} data-link={months.active.includes(key) ? 'lit' : undefined} {...months.trigger([key])}>
                    {MONTH.format(dates[first])}
                  </span>
                );
              })}
            </div>
            <div className={styles.days} role="img" aria-label={label}>
              {blanks}
              {cells}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.monthGrid} role="img" aria-label={label}>
          {WEEKDAYS.map((weekday) => (
            <span key={weekday} className={styles.weekday} aria-hidden>
              {weekday}
            </span>
          ))}
          {blanks}
          {cells}
        </div>
      )}
      <Scale note={note} scale={scale} />
      <ChartTip pointed={page.pointed} frame={frame} />
    </figure>
  );
}
