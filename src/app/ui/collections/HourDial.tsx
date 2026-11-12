import { useRef, type CSSProperties } from 'react';
import { ChartTip } from './ChartTip';
import { linkState, useLinks } from './link';
import styles from './HourDial.module.css';

type DialHour = { value: number; title: string; note: string; keys: string[]; links: string[] };

// In the viewBox: the centre, where the rays start and how far the busiest reaches, the night's arc and the numerals.
const CENTER = 60;
const INNER = 17;
const OUTER = 41;
const NIGHT = 46;
const NUMERALS = 54;
const NUMERAL_HOURS = [0, 6, 12, 18];

// Midnight at the top, clockwise.
const point = (hour: number, radius: number) => {
  const turn = (hour / 24) * 2 * Math.PI - Math.PI / 2;
  return { x: CENTER + Math.cos(turn) * radius, y: CENTER + Math.sin(turn) * radius };
};

// peak: the hour drawn at the full accent.
export function HourDial({ label, hours, peak }: { label: string; hours: DialHour[]; peak: number }) {
  const links = useLinks();
  const frame = useRef<HTMLDivElement>(null);
  const most = Math.max(1, ...hours.map((hour) => hour.value));
  const dusk = point(18, NIGHT);
  const dawn = point(6, NIGHT);
  return (
    <div ref={frame} className={styles.dial}>
      <svg className={styles.drawing} viewBox={`0 0 ${CENTER * 2} ${CENTER * 2}`} role="img" aria-label={label}>
        <path className={styles.night} d={`M ${dusk.x} ${dusk.y} A ${NIGHT} ${NIGHT} 0 0 1 ${dawn.x} ${dawn.y}`} />
        {hours.map((hour, at) => {
          const from = point(at, INNER);
          const to = point(at, INNER + 2 + (OUTER - INNER - 2) * (hour.value / most));
          const strength = at === peak ? 1 : 0.22 + (0.6 * hour.value) / most;
          return <line key={at} className={styles.ray} x1={from.x} y1={from.y} x2={to.x} y2={to.y} style={{ '--ray': strength } as CSSProperties} data-link={linkState(links.active, hour.keys) ?? undefined} />;
        })}
        {/* Wider and unseen over the rays, so a thin one is easy to point at. */}
        {hours.map((hour, at) => {
          const from = point(at, INNER - 4);
          const to = point(at, OUTER + 3);
          return <line key={at} className={styles.hit} x1={from.x} y1={from.y} x2={to.x} y2={to.y} {...links.trigger(hour.links, hour)} />;
        })}
        {NUMERAL_HOURS.map((hour) => {
          const at = point(hour, NUMERALS);
          return (
            <text key={hour} className={styles.numeral} x={at.x} y={at.y}>
              {hour}
            </text>
          );
        })}
      </svg>
      <ChartTip pointed={links.pointed} frame={frame} />
    </div>
  );
}
