import styles from './StatusRadar.module.css';

type Axis = { id: string; name: string; share: number; value: string };

const SIZE = 180;
const MIDDLE = SIZE / 2;
const REACH = 70;
// Where a share of an axis stands: the first axis points up, the rest follow clockwise.
const at = (index: number, count: number, share: number) => {
  const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
  return [MIDDLE + Math.cos(angle) * REACH * share, MIDDLE + Math.sin(angle) * REACH * share] as const;
};
const points = (count: number, share: (index: number) => number) => Array.from({ length: count }, (_, index) => at(index, count, share(index)).map((value) => value.toFixed(1)).join(',')).join(' ');
const anchor = (x: number) => (Math.abs(x - MIDDLE) < 1 ? 'middle' : x > MIDDLE ? 'start' : 'end');

// Several gauges as one shape, an axis each, beside their figures. Fewer than three axes make no shape, so the caller
// gives three or more.
export function StatusRadar({ axes }: { axes: Axis[] }) {
  const count = axes.length;
  const label = axes.map(({ name, value }) => `${name} ${value}`).join(', ');
  return (
    <div className={styles.radar}>
      <svg className={styles.shape} viewBox={`-24 -8 ${SIZE + 48} ${SIZE + 16}`} role="img" aria-label={label}>
        {[1, 0.5].map((share) => (
          <polygon key={share} className={styles.web} points={points(count, () => share)} />
        ))}
        {axes.map(({ id }, index) => {
          const [x, y] = at(index, count, 1);
          return <line key={id} className={styles.web} x1={MIDDLE} y1={MIDDLE} x2={x} y2={y} />;
        })}
        <polygon className={styles.area} points={points(count, (index) => Math.max(0, Math.min(1, axes[index]!.share)))} />
        {axes.map(({ id, name }, index) => {
          const [x, y] = at(index, count, 1.16);
          return (
            <text key={id} className={styles.axis} x={x} y={y} textAnchor={anchor(x)} dominantBaseline="middle">
              {name}
            </text>
          );
        })}
      </svg>
      <dl className={styles.figures}>
        {axes.map(({ id, name, value }) => (
          <div key={id}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
