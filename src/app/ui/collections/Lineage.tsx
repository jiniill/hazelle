import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { placeStems, type Metrics, type PlacedSprout, type Sprout, type Stem } from './stems';
import styles from './Lineage.module.css';

type Props = {
  root: Stem;
  label: string;
  // The card at a stem's head.
  head: (stem: Stem) => ReactNode;
  // A sprout's mark pressed.
  onSprout: (parent: Stem, sprout: Sprout) => void;
};

// The sizes the lines are drawn with are the stylesheet's, read once: the SVG takes numbers.
function readMetrics(): Metrics {
  const style = getComputedStyle(document.documentElement);
  const px = (name: string) => parseFloat(style.getPropertyValue(name));
  return { unit: px('--lineage-unit'), min: px('--lineage-line-min'), max: px('--lineage-line-max'), head: { width: px('--lineage-head-width'), height: px('--lineage-head') }, gap: px('--lineage-gap'), drop: px('--lineage-drop') };
}

// Out of the parent sideways, into the child's head from above.
const curve = ({ parent, child, y }: PlacedSprout) => `M ${parent.x} ${y} C ${(parent.x + child.x) / 2} ${y}, ${child.x} ${y}, ${child.x} ${child.top}`;

const markOf = ({ kind, at }: Sprout) => (kind === 'copy' ? styles.copyMark : at === null ? styles.unplacedMark : styles.mark);

export function Lineage({ root, label, head, onSprout }: Props) {
  const [metrics] = useState(readMetrics);
  const { width, height, stems, sprouts } = useMemo(() => placeStems(root, metrics), [root, metrics]);
  // The map opens on the reader's own stem, which may stand past the panel's edge.
  const own = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    own.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);
  return (
    <div className={styles.map} style={{ width, height }}>
      <svg className={styles.lines} width={width} height={height} aria-hidden>
        {stems.map(({ stem, x, from, to }) => (
          <line key={stem.key} className={stem.ghost ? styles.ghost : stem.current ? styles.current : styles.line} x1={x} y1={from} x2={x} y2={to} />
        ))}
        {sprouts.map((placed) => (
          <path key={placed.child.stem.key} className={placed.sprout.kind === 'copy' ? styles.copy : styles.line} d={curve(placed)} />
        ))}
      </svg>
      <ul className={styles.heads} aria-label={label}>
        {stems.map(({ stem, x, top }) => (
          <li key={stem.key} ref={stem.current ? own : undefined} className={styles.head} style={{ left: x - metrics.head.width / 2, top }}>
            {head(stem)}
          </li>
        ))}
      </ul>
      {sprouts.map(({ sprout, parent, y }) => {
        const mark = { className: markOf(sprout), style: { left: parent.x, top: y }, title: sprout.label, 'aria-label': sprout.label };
        // A ghost's sprouts have nothing to open.
        return parent.stem.ghost ? <span key={sprout.stem.key} role="img" {...mark} /> : <button key={sprout.stem.key} type="button" {...mark} onClick={() => onSprout(parent.stem, sprout)} />;
      })}
    </div>
  );
}
