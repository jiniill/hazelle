import { useState, type ComponentType } from 'react';
import { ChoiceGroup } from '../controls/ChoiceGroup';
import { useReducedMotion } from '../foundation/media';
import { CacheNoteDemo, EnterSendsDemo } from './ComposerDemos';
import { FollowSystemDemo, LorebookDemo, MemoryDemo, PromptCacheDemo, ReverseDemo } from './FlowDemos';
import { AutoIllustrateDemo, ComicDemo, FoldLongDemo, HidePicturesDemo, InlineIllustrationsDemo, PictureSideDemo, PortraitDemo, PovDemo, WideFillDemo } from './PictureDemos';
import { BotStyleDemo, ThoughtsDemo, TranslateOriginalDemo, UsageDemo } from './ReplyDemos';
import { FoldComposerDemo, HideHeaderDemo, ReplyScrollDemo, ScrubberDemo, StepButtonsDemo, UserStopsDemo } from './ScrollDemos';
import styles from './Demo.module.css';

// way 0 is the first of `ways` (켜면, or a choice's first option); a demo without ways plays way 0 only.
export type Way = 0 | 1;
type DemoDrawing = ComponentType<{ way: Way }>;

const DRAWINGS = {
  hideHeader: HideHeaderDemo,
  foldComposer: FoldComposerDemo,
  scrubber: ScrubberDemo,
  stepButtons: StepButtonsDemo,
  userStops: UserStopsDemo,
  enterSends: EnterSendsDemo,
  replyScroll: ReplyScrollDemo,
  hidePictures: HidePicturesDemo,
  wideFill: WideFillDemo,
  inlineIllustrations: InlineIllustrationsDemo,
  pictureSide: PictureSideDemo,
  portrait: PortraitDemo,
  usage: UsageDemo,
  cacheNote: CacheNoteDemo,
  followSystem: FollowSystemDemo,
  botStyle: BotStyleDemo,
  foldLong: FoldLongDemo,
  thoughts: ThoughtsDemo,
  translateOriginal: TranslateOriginalDemo,
  reverse: ReverseDemo,
  autoIllustrate: AutoIllustrateDemo,
  pov: PovDemo,
  comic: ComicDemo,
  promptCache: PromptCacheDemo,
  lorebook: LorebookDemo,
  memory: MemoryDemo,
} satisfies Record<string, DemoDrawing>;

type DemoName = keyof typeof DRAWINGS;

// Without ways, a demo plays only what turning its setting on adds; with them it alternates both, the current one marked.
// on: a switch's two ways. labels: a choice of two, `now` the one chosen.
type Choice = { labels: readonly [string, string]; now: Way };
export type DemoSpec = { name: DemoName; ways?: { on: boolean } | Choice };

const SWITCH_WAYS = ['켜면', '끄면'] as const;
const NOW = '지금';

export type Round = { way: Way; held: boolean; count: number };

// A round ends: the next alternates unless a way was picked, and replays (count) either way.
export const nextRound = (round: Round, alternates: boolean): Round => ({ ...round, way: alternates && !round.held ? (round.way === 0 ? 1 : 0) : round.way, count: round.count + 1 });

export function Demo({ label, name, ways }: DemoSpec & { label: string }) {
  const still = useReducedMotion();
  const choice: Choice | undefined = ways && ('on' in ways ? { labels: SWITCH_WAYS, now: ways.on ? 0 : 1 } : ways);
  const [round, setRound] = useState<Round>({ way: choice?.now ?? 0, held: false, count: 0 });
  const Drawing: DemoDrawing = DRAWINGS[name];
  return (
    <div className={styles.demo}>
      <div className={styles.stage} aria-hidden>
        <Drawing key={round.count} way={round.way} />
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
