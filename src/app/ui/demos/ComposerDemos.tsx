import { Timer, TriangleAlert } from 'lucide-react';
import { Icon } from '../foundation/Icon';
import type { Way } from './Demo';
import { appears, Composer, dock, Feed, Key, Line, Message, top, when } from './DemoParts';
import styles from './ComposerDemos.module.css';

// Keys pressed together at a step, shown beside the send button for a moment.
function Keys({ at, names }: { at: number; names: string[] }) {
  return (
    <span className={styles.keys} style={when(at)}>
      {names.map((name) => (
        <Key key={name} motion={styles.key}>
          {name}
        </Key>
      ))}
    </span>
  );
}

// Enter is pressed at the same step both ways, so the two differ only in what it does.
const ENTER = 0.3;
const CTRL_ENTER = 0.62;
// What a key does lands just after it is pressed.
const LANDS = 0.03;

// way 0: Enter sends what was written. way 1: Enter breaks the line, and Ctrl+Enter sends.
export function EnterSendsDemo({ way }: { way: Way }) {
  const sent = (way === 0 ? ENTER : CTRL_ENTER) + LANDS;
  return (
    <span>
      <Feed motion={top}>
        <Message lines={[92, 84, 60]} />
        <Message lines={way === 0 ? [80] : [80, 56]} mine motion={appears} at={sent} />
      </Feed>
      <Composer
        motion={dock}
        sent={way === 0 ? ENTER : CTRL_ENTER}
        note={
          <span className={styles.stack}>
            <Keys at={ENTER} names={['Enter']} />
            {way === 1 && <Keys at={CTRL_ENTER} names={['Ctrl', 'Enter']} />}
          </span>
        }
      >
        <span className={styles.draft} style={when(sent)}>
          <Line width={60} typing={0.04} />
          {way === 1 && <Line width={40} typing={ENTER + LANDS} />}
        </span>
      </Composer>
    </span>
  );
}

// The cache's time left, beside the send button once a reply is in; each about a second after the one before.
const SHOWN = 0.34;
const SECOND = 0.2;
const CLOCK = ['4:59', '4:58', '4:57', '4:56'];
// An earlier message is edited, and the note warns the next send will miss the cache.
const EDITED = 0.56;
const WARNED = 0.62;
const BROKEN = '캐시 깨짐';

export function CacheNoteDemo() {
  return (
    <span>
      <Feed motion={top}>
        <Message lines={[90]} mine motion={styles.edited} at={EDITED}>
          <Line width={60} motion={styles.rewritten} />
        </Message>
        <Message lines={[94, 86, 70]} typing={0.04} />
      </Feed>
      <Composer
        motion={dock}
        note={
          <span className={appears} style={when(SHOWN)}>
            <span className={styles.note} style={when(WARNED)}>
              <span className={styles.stack}>
                <Icon icon={Timer} size="sm" />
                <span className={styles.turns}>
                  <Icon icon={TriangleAlert} size="sm" />
                </span>
              </span>
              <span className={styles.stack}>
                {CLOCK.map((time, second) => (
                  <span key={time} className={styles.second} style={when(SHOWN + second * SECOND)}>
                    {time}
                  </span>
                ))}
              </span>
              <span className={styles.widens}>
                <span>· {BROKEN}</span>
              </span>
            </span>
          </span>
        }
      />
    </span>
  );
}
