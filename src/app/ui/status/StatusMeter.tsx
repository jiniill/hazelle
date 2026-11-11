import { Heart, Star } from 'lucide-react';
import type { CSSProperties } from 'react';
import { classNames } from '../foundation/classNames';
import type { MeterLook, StatusTone } from './shown';
import styles from './StatusMeter.module.css';

type Props = { name: string; look: MeterLook; share: number; zero?: number; steps: number; tone?: StatusTone; size?: 'sm' | 'md' | 'lg'; text?: string };

const MARKS = 5;
const fraction = (value: number) => Math.max(0, Math.min(1, value));
const cells = (count: number, filled: number) => Array.from({ length: count }, (_, at) => at < filled);

// A gauge's drawing alone: a bar (from where 0 stands, in a range across it), cells, a ring round its figure, or
// hearts or stars. Read aloud as a meter, by its share.
export function StatusMeter({ name, look, share, zero, steps, tone = 'accent', size = 'md', text }: Props) {
  const at = fraction(share);
  const meter = { role: 'meter', 'aria-label': name, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(at * 100), ...(text && { 'aria-valuetext': text }) } as const;
  if (look === 'segments') {
    return (
      <span {...meter} className={classNames(styles.cells, styles[tone], size !== 'md' && styles[size])} style={{ '--steps': steps } as CSSProperties}>
        {cells(steps, Math.round(at * steps)).map((on, index) => (
          <span key={index} className={on ? styles.on : styles.off} />
        ))}
      </span>
    );
  }
  if (look === 'hearts' || look === 'stars') {
    const Mark = look === 'hearts' ? Heart : Star;
    return (
      <span {...meter} className={classNames(styles.marks, styles[tone])}>
        {cells(MARKS, Math.round(at * MARKS)).map((on, index) => (
          <Mark key={index} className={on ? styles.markOn : styles.markOff} aria-hidden />
        ))}
      </span>
    );
  }
  if (look === 'ring') {
    return (
      <span {...meter} className={classNames(styles.ring, styles[tone])}>
        <svg viewBox="0 0 36 36" aria-hidden>
          <circle className={styles.ringTrack} cx="18" cy="18" r="15.5" pathLength={100} />
          <circle className={styles.ringFill} cx="18" cy="18" r="15.5" pathLength={100} strokeDasharray={`${at * 100} 100`} />
        </svg>
        {text && <span className={styles.ringText}>{text}</span>}
      </span>
    );
  }
  const from = zero === undefined ? 0 : Math.min(fraction(zero), at);
  const span = zero === undefined ? at : Math.abs(at - fraction(zero));
  return (
    <span {...meter} className={classNames(styles.bar, styles[tone], size !== 'md' && styles[size])}>
      <span className={styles.fill} style={{ '--from': from, '--span': span } as CSSProperties} />
      {zero !== undefined && <span className={styles.zero} style={{ '--from': fraction(zero) } as CSSProperties} />}
    </span>
  );
}
