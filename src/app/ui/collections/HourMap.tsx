import { useMemo, useRef } from 'react';
import { ChartTip } from './ChartTip';
import { RAMP, Scale } from './Scale';
import { linearLevels } from './levels';
import { linkState, useLinks } from './link';
import styles from './HourMap.module.css';

export type HourCell = { value: number; title: string; note: string; keys: string[]; links: string[] };
type HourRow = { label: string; keys: string[]; links: string[]; cells: HourCell[] };

// The axis names every sixth hour.
const AXIS = [0, 6, 12, 18];

// hours: the 24 hours' names, of which the axis shows four.
export function HourMap({ label, rows, hours, scale, note }: { label: string; rows: HourRow[]; hours: string[]; scale: { low: string; high: string }; note?: string }) {
  const links = useLinks();
  const frame = useRef<HTMLElement>(null);
  const levels = useMemo(() => linearLevels(rows.flatMap((row) => row.cells.map((cell) => cell.value))), [rows]);
  return (
    <figure ref={frame} className={styles.map}>
      <div className={styles.grid} role="img" aria-label={label}>
        {rows.map((row, at) => (
          <div key={row.label} className={styles.row}>
            <span className={styles.label} data-link={linkState(links.active, row.keys) ?? undefined} {...links.trigger(row.links)}>
              {row.label}
            </span>
            {row.cells.map((cell, hour) => (
              <span key={hour} className={`${styles.cell} ${RAMP[levels[at * 24 + hour]!]}`} data-link={linkState(links.active, cell.keys) ?? undefined} {...links.trigger(cell.links, cell)} />
            ))}
          </div>
        ))}
        <div className={styles.row} aria-hidden>
          {AXIS.map((hour) => (
            <span key={hour} className={styles.axis} style={{ gridColumn: `${hour + 2} / span 6` }}>
              {hours[hour]}
            </span>
          ))}
        </div>
      </div>
      <Scale note={note} scale={scale} />
      <ChartTip pointed={links.pointed} frame={frame} />
    </figure>
  );
}
