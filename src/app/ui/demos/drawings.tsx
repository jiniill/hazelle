import type { ComponentType } from 'react';
import { CacheNoteDemo, EnterSendsDemo } from './ComposerDemos';
import { FollowSystemDemo, LorebookDemo, MemoryDemo, PromptCacheDemo, ReverseDemo } from './FlowDemos';
import { AutoIllustrateDemo, ComicDemo, FoldLongDemo, HidePicturesDemo, InlineIllustrationsDemo, PictureSideDemo, PortraitDemo, PovDemo, WideFillDemo } from './PictureDemos';
import { BotStyleDemo, InkDemo, ThoughtsDemo, TranslateOriginalDemo, UsageDemo } from './ReplyDemos';
import { FoldComposerDemo, HideHeaderDemo, ReplyScrollDemo, ScrubberDemo, StepButtonsDemo, UserStopsDemo } from './ScrollDemos';
import type { Way } from './Demo';

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
  ink: InkDemo,
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

export type DemoName = keyof typeof DRAWINGS;

export function Drawing({ name, way }: { name: DemoName; way: Way }) {
  const Drawn: DemoDrawing = DRAWINGS[name];
  return <Drawn way={way} />;
}
