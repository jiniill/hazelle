import styles from './Scale.module.css';

// The one-hue ramp's steps (levels.ts), from an empty slot to the accent, which DayMap and HourMap fill their cells with.
export const RAMP = [styles.l0, styles.l1, styles.l2, styles.l3, styles.l4];

// A heat chart's foot: its note at the start, the ramp read from low to high at the end.
export function Scale({ note, scale }: { note?: string; scale: { low: string; high: string } }) {
  return (
    <figcaption className={styles.foot}>
      <span>{note}</span>
      <span className={styles.scale}>
        {scale.low}
        <span className={styles.steps} aria-hidden>
          {RAMP.map((step) => (
            <span key={step} className={`${styles.step} ${step}`} />
          ))}
        </span>
        {scale.high}
      </span>
    </figcaption>
  );
}
