import { lazy, Suspense, useState } from 'react';
import { ChoiceGroup } from '../controls/ChoiceGroup';
import { useReducedMotion } from '../foundation/media';
import type { DemoName } from './drawings';
import styles from './Demo.module.css';

// way 0 is the first of `ways` (켜면, or a choice's first option); a demo without ways plays way 0 only.
export type Way = 0 | 1;

// The drawings come apart from the kit, with the first demo drawn: its stage keeps its size meanwhile.
const Drawing = lazy(() => import('./drawings').then(({ Drawing }) => ({ default: Drawing })));

// Without ways, a demo plays only what turning its setting on adds; with them it alternates both, the current one marked.
// on: a switch's two ways. labels: a choice of two, `now` the one chosen.
type Choice = { labels: readonly [string, string]; now: Way };
export type DemoSpec = { name: DemoName; ways?: { on: boolean } | Choice };

const SWITCH_WAYS = ['켜면', '끄면'] as const;
const NOW = '지금';

export type Round = { way: Way; held: boolean; count: number };

// A round ends: the next alternates unless a way was picked, and replays (count) either way.
export const nextRound = (round: Round, alternates: boolean): Round => ({ ...round, way: alternates && !round.held ? (round.way === 0 ? 1 : 0) : round.way, count: round.count + 1 });

// bare: the stage alone to its box's edges, for a box that frames it (a dialog's picture).
export function Demo({ label, name, ways, bare = false }: DemoSpec & { label: string; bare?: boolean }) {
  const still = useReducedMotion();
  const choice: Choice | undefined = ways && ('on' in ways ? { labels: SWITCH_WAYS, now: ways.on ? 0 : 1 } : ways);
  const [round, setRound] = useState<Round>({ way: choice?.now ?? 0, held: false, count: 0 });
  return (
    <div className={bare ? `${styles.demo} ${styles.bare}` : styles.demo}>
      <div className={styles.stage} aria-hidden>
        <Suspense fallback={null}>
          <Drawing key={round.count} name={name} way={round.way} />
        </Suspense>
      </div>
      {choice && (
        <ChoiceGroup
          layout="segmented"
          label={label}
          options={choice.labels.map((words, at) => ({ value: String(at), label: words, tag: at === choice.now ? NOW : undefined }))}
          value={String(round.way)}
          onChange={(picked) => setRound((now) => ({ way: picked === '1' ? 1 : 0, held: true, count: now.count + 1 }))}
        />
      )}
      {/* The round's clock: its end starts the next, so the round's length is the token's alone. Still, it stops after one. */}
      <span className={styles.clock} aria-hidden>
        <span key={round.count} className={round.held ? `${styles.hand} ${styles.held}` : styles.hand} onAnimationEnd={() => !still && setRound((now) => nextRound(now, choice !== undefined))} />
      </span>
    </div>
  );
}
