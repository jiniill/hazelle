import { useLayoutEffect, useRef, type RefObject } from 'react';
import { room } from '../overlays/layers';
import { tokenPx } from '../foundation/tokenPx';
import type { Links } from './link';
import styles from './ChartTip.module.css';

// frame: the chart's own box, positioned, which the tip leaves sideways only where it is wider. Every chart under one scope is handed
// the same pointed mark; only the one whose frame holds it shows the tip.
export function ChartTip({ pointed, frame }: { pointed: Links['pointed']; frame: RefObject<HTMLElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tip = box.current;
    const host = frame.current;
    if (!tip || !host || !pointed) return;
    tip.hidden = !host.contains(pointed.at);
    if (tip.hidden) return;
    const at = pointed.at.getBoundingClientRect();
    const own = host.getBoundingClientRect();
    const gap = tokenPx('--space-8', tip);
    const clear = room(tip);
    // A chart narrower than its tip, such as a dial, lends it the room of the box it stands in.
    const sides = tip.offsetWidth <= own.width ? own : clear;
    const middle = at.left + at.width / 2;
    const left = Math.max(sides.left, Math.min(sides.right - tip.offsetWidth, middle - tip.offsetWidth / 2));
    const above = at.top - tip.offsetHeight - gap;
    const below = above < clear.top;
    tip.toggleAttribute('data-below', below);
    tip.style.left = `${left - own.left}px`;
    tip.style.top = `${(below ? at.bottom + gap : above) - own.top}px`;
    tip.style.setProperty('--tip-point', `${middle - left}px`);
  }, [pointed, frame]);
  const tip = pointed?.tip;
  if (!tip) return null;
  return (
    <div ref={box} className={styles.tip} role="tooltip" hidden>
      <span className={styles.title}>{tip.title}</span>
      <span className={styles.note}>{tip.note}</span>
    </div>
  );
}
