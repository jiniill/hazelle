import { useState, type MouseEvent } from 'react';
import styles from './Bars.module.css';

type Bar = { label: string; value: number; detail: string };

export function nearestBar(x: number, centers: number[]): number {
  return centers.reduce((best, center, index) => (Math.abs(center - x) < Math.abs(centers[best]! - x) ? index : best), 0);
}

// Read out hover, then tapped selection, then the latest nonzero bar; data stays oldest-first.
export function Bars({ label, bars }: { label: string; bars: Bar[] }) {
  const [hovered, hover] = useState<number | null>(null);
  const [picked, pick] = useState<number | null>(null);
  const most = Math.max(0, ...bars.map(({ value }) => value));
  const latest = bars.findLastIndex(({ value }) => value > 0);
  const current = hovered ?? picked ?? (latest === -1 ? bars.length - 1 : latest);
  const shown = bars[current];
  // A press between the bars or past the last one; a column's own click covers the rest, the keyboard's included.
  const pickNearest = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const centers = [...event.currentTarget.children].map((column) => {
      const { left, width } = column.getBoundingClientRect();
      return left + width / 2;
    });
    pick(nearestBar(event.clientX, centers));
  };
  return (
    <figure className={styles.bars}>
      <div className={styles.plot} role="group" aria-label={label} onClick={pickNearest}>
        {bars.map((bar, index) => (
          <button
            key={index}
            type="button"
            className={styles.column}
            aria-label={`${bar.label} ${bar.detail}`}
            aria-pressed={index === current}
            onPointerEnter={(event) => event.pointerType === 'mouse' && hover(index)}
            onPointerLeave={(event) => event.pointerType === 'mouse' && hover(null)}
            onFocus={() => pick(index)}
            onClick={() => pick(index)}
          >
            {bar.value > 0 && <span className={styles.bar} style={{ height: `${(bar.value / most) * 100}%` }} />}
          </button>
        ))}
      </div>
      <div className={styles.axis} aria-hidden>
        <span>{bars[0]?.label}</span>
        {bars.length > 1 && <span>{bars.at(-1)!.label}</span>}
      </div>
      {shown && (
        <figcaption className={styles.readout}>
          <span className={styles.when}>{shown.label}</span>
          <span>{shown.detail}</span>
        </figcaption>
      )}
    </figure>
  );
}
