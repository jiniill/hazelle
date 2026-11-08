import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import type { Way } from './Demo';
import { Composer, dock, Feed, Header, join, Line, Message, top, when, type Lines } from './DemoParts';
import styles from './ScrollDemos.module.css';

const STORY: Lines[] = [[96, 88, 70], [80], [94, 90, 86, 60], [90, 50], [92, 84, 76], [70]];
const story = STORY.map((lines, at) => <Message key={at} lines={lines} mine={at % 2 === 1} />);

// Follows the drawing's --scrolled, so it shows which way the story is being read.
const Scrollbar = () => <span className={styles.scrollbar} />;

// Shown from at for span (shares of the round), then gone.
function Lit({ look, at, span, children }: { look: string; at: number; span: number; children?: ReactNode }) {
  return (
    <span className={join(look, styles.lit)} style={when(at, { '--for': span })}>
      {children}
    </span>
  );
}

// way 0 hides the header while the story is read down and brings it back on the way up; way 1 keeps it.
export function HideHeaderDemo({ way }: { way: Way }) {
  return (
    <span className={styles.readsDown}>
      <Feed motion={styles.underHeader}>{story}</Feed>
      <Header motion={join(top, way === 0 && styles.hides)} />
      <Scrollbar />
    </span>
  );
}

// way 0 folds the composer to its one line of text while older messages are read and opens it again at the bottom;
// way 1 keeps it whole.
export function FoldComposerDemo({ way }: { way: Way }) {
  const folds = way === 0 && styles.foldsAway;
  return (
    <span className={styles.readsUp}>
      <Feed motion={join(styles.aboveComposer, styles.readsOlder)}>{story}</Feed>
      <Composer motion={join(dock, styles.whole, way === 0 && styles.folds)}>
        <Line width={72} />
        <Line width={44} motion={folds} />
        <span className={join(styles.tools, folds)}>
          {[0, 1, 2].map((tool) => (
            <Line key={tool} width={10} />
          ))}
        </span>
      </Composer>
      <Scrollbar />
    </span>
  );
}

// way 0 follows the reply down as it is written; way 1 stays where the reader was, and a pill offers the way down.
export function ReplyScrollDemo({ way }: { way: Way }) {
  return (
    <span className={styles.replying}>
      <Feed motion={join(styles.aboveComposer, styles.unwritten, way === 0 && styles.follows)}>
        <Message lines={[96, 88, 70]} />
        <Message lines={[90, 55]} mine />
        <Message lines={[94, 86, 90, 78, 92, 84, 60]} typing={0.05} />
      </Feed>
      <Composer motion={dock} />
      {way === 1 && (
        <span className={styles.pill}>
          <span className={styles.live} />
          <Icon icon={ChevronDown} size="sm" />
        </span>
      )}
    </span>
  );
}

// Each jump moves its --by of the parent's --unit at its step; nested, so each adds to the ones before it.
type Jump = { at: number; by: number };
const Jumps = ({ jumps, children }: { jumps: readonly Jump[]; children: ReactNode }) =>
  jumps.reduceRight<ReactNode>(
    (inner, { at, by }) => (
      <span className={styles.jump} style={when(at, { '--by': by })}>
        {inner}
      </span>
    ),
    children,
  );

// Under the scrubber's steps, so one ring is gone before the next.
const RING = 0.1;
// Four fit the view, so from the top seven more moves reach the chat's last message.
const MESSAGES = 11;
// Messages of one height, so each stop is one --stop; rings: when each message is stopped at.
function Stops({ jumps, rings }: { jumps: readonly Jump[]; rings: ReadonlyMap<number, number> }) {
  return (
    <Jumps jumps={jumps}>
      <Feed motion={join(top, styles.gutter)}>
        {Array.from({ length: MESSAGES }, (_, at) => {
          const ring = rings.get(at);
          return (
            <Message key={at} lines={[90, 60]} mine={at % 2 === 0} motion={ring !== undefined && styles.ringed}>
              {ring !== undefined && <Lit look={styles.ring} at={ring} span={RING} />}
            </Message>
          );
        })}
      </Feed>
    </Jumps>
  );
}

const GRAB = 0.1;
const RELEASE = 0.68;
const DRAG: Jump[] = [0.2, 0.32, 0.44, 0.56].map((at) => ({ at, by: 1 }));
const DRAG_STOPS = [GRAB, ...DRAG.map(({ at }) => at)];
const DRAG_RINGS = new Map(DRAG_STOPS.map((at, stop) => [stop, at]));

// The thumb is held from GRAB to RELEASE and snaps a message at each step, the one it reached at the view's top.
export function ScrubberDemo() {
  return (
    <span className={styles.stops}>
      <Stops jumps={DRAG} rings={DRAG_RINGS} />
      <span className={styles.track} style={when(undefined, { '--steps': DRAG.length })}>
        <Jumps jumps={DRAG}>
          <span className={styles.thumb}>
            <Lit look={styles.grip} at={GRAB} span={RELEASE - GRAB} />
            {DRAG_STOPS.map((at, stop) => (
              <Lit key={stop} look={styles.tag} at={at} span={(DRAG_STOPS[stop + 1] ?? RELEASE) - at}>
                #{stop + 1}
              </Lit>
            ))}
          </span>
        </Jumps>
      </span>
    </span>
  );
}

const PRESS = 0.05;
const HINT = 0.16;
// The message at the view's bottom before any press: a press down lands a message's end there.
const BOTTOM = 3;
// hold: how long the press is held before it moves; hint: the place it reached, beside the buttons.
type Press = { at: number; by: number; hold?: number; hint?: string };

function Stepper({ presses }: { presses: readonly Press[] }) {
  const jumps = presses.map(({ at, by, hold = 0 }) => ({ at: at + hold, by }));
  let reached = BOTTOM;
  const rings = new Map(jumps.map(({ at, by }) => [(reached += by), at]));
  return (
    <span className={styles.stops}>
      <Stops jumps={jumps} rings={rings} />
      <span className={styles.steps}>
        {presses.map(({ hint }, n) => hint && <Lit key={n} look={styles.tag} at={jumps[n]!.at} span={HINT}>{hint}</Lit>)}
        <span className={styles.buttons}>
          <span className={styles.step}>
            <Icon icon={ChevronUp} size="sm" />
          </span>
          <span className={styles.rule} />
          <span className={styles.step}>
            {presses.map(({ at, hold }) => <Lit key={at} look={hold ? styles.held : styles.press} at={at} span={hold ?? PRESS} />)}
            <Icon icon={ChevronDown} size="sm" />
          </span>
        </span>
      </span>
    </span>
  );
}

// Two presses land the next messages' ends; a long one goes to the bottom of the chat, the last message.
const STEPS: Press[] = [
  { at: 0.12, by: 1, hint: '#5 끝' },
  { at: 0.34, by: 1, hint: '#6 끝' },
  { at: 0.54, by: 5, hold: 0.14, hint: '맨 아래' },
];
export const StepButtonsDemo = () => <Stepper presses={STEPS} />;

// The same presses: way 0 lands every message, way 1 the character's only, so each press goes two.
const STOP_TIMES = [0.14, 0.4, 0.66];
const EVERY = STOP_TIMES.map((at) => ({ at, by: 1 }));
const THEIRS = STOP_TIMES.map((at) => ({ at, by: 2 }));
export const UserStopsDemo = ({ way }: { way: Way }) => <Stepper presses={way === 0 ? EVERY : THEIRS} />;
