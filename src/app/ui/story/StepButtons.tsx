import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAwake } from './awake';
import styles from './StepButtons.module.css';

type Direction = 'up' | 'down';

type Props = {
  scrollRef: RefObject<HTMLElement | null>;
  labels: Record<Direction, string>;
  // Each returns the place it reached, shown beside the buttons for a moment.
  onStep: (direction: Direction) => string;
  onEnd: (direction: Direction) => string;
};

const WAIT = 2500;
const HOLD = 450;
const HINT = 1400;

export function StepButtons({ scrollRef, labels, onStep, onEnd }: Props) {
  const { awake, wake } = useAwake(scrollRef, WAIT);
  // n counts the places shown, so the same place reached twice shows again.
  const [hint, setHint] = useState<{ label: string; n: number } | null>(null);
  const shown = useRef(0);
  const press = useRef({ timer: 0, held: false });
  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), HINT);
    return () => window.clearTimeout(timer);
  }, [hint]);
  useEffect(() => () => window.clearTimeout(press.current.timer), []);
  const show = (label: string) => {
    setHint({ label, n: ++shown.current });
    wake();
  };
  const release = () => window.clearTimeout(press.current.timer);
  const button = (direction: Direction) => (
    <button
      type="button"
      className={styles.step}
      aria-label={labels[direction]}
      title={labels[direction]}
      onPointerDown={() => {
        release();
        press.current = { held: false, timer: window.setTimeout(() => {
          press.current.held = true;
          show(onEnd(direction));
        }, HOLD) };
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      // A held touch would open the browser's menu.
      onContextMenu={(event) => event.preventDefault()}
      onClick={() => {
        if (press.current.held) press.current.held = false;
        else show(onStep(direction));
      }}
    >
      {direction === 'up' ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
    </button>
  );
  return (
    <div className={`${styles.steps} ${awake || hint ? styles.awake : ''}`}>
      <span className={styles.hint} role="status">
        {hint && <span key={hint.n} className={styles.label}>{hint.label}</span>}
      </span>
      <div className={styles.buttons}>
        {button('up')}
        <span className={styles.rule} />
        {button('down')}
      </div>
    </div>
  );
}
