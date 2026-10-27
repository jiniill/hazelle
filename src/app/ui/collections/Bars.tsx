import { useState } from 'react';
import styles from './Bars.module.css';

type Bar = { label: string; value: number; detail: string };

// Read out hover, then tapped selection, then the latest nonzero bar; data stays oldest-first.
export function Bars({ label, bars }: { label: string; bars: Bar[] }) {
  const [hovered, hover] = useState<number | null>(null);
  const [picked, pick] = useState<number | null>(null);
  const most = Math.max(0, ...bars.map(({ value }) => value));
  const latest = bars.findLastIndex(({ value }) => value > 0);
  const current = hovered ?? picked ?? (latest === -1 ? bars.length - 1 : latest);
  const shown = bars[current];
  return (
    <figure className={styles.bars}>
      <div className={styles.plot} role="group" aria-label={label}>
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
