import { FRAME_INVOKERS, type AutoFrame, type AutoReport, type SlowPage } from '../../contracts/auto-diagnosis';
import { ownScript } from '../installation';

// The browser's long animation frames, where it reports them: a frame over 50 ms, what of it blocked input, and the
// scripts that ran in it.
type FrameScript = { duration: number; forcedStyleAndLayoutDuration: number; invokerType: string; sourceURL: string; sourceCharPosition: number };
export type LongFrame = { startTime: number; duration: number; blockingDuration: number; renderStart: number; scripts: FrameScript[] };

const KIND = 'long-animation-frame';
// One frame this long held the page.
const FROZEN_MS = 2_000;
// This much blocking within WINDOW_MS, in frames each too short to say so alone.
const JANKY_MS = 3_000;
const WINDOW_MS = 10_000;
// A frame this long is told to its watcher whatever it makes of the page.
const LONG_MS = 500;

let stats: AutoReport['stalls'] = null;
export const stalls = (): AutoReport['stalls'] => stats && { ...stats };

export const slowness = (ms: number, recent: number): SlowPage | null => (ms >= FROZEN_MS ? 'frozen' : recent >= JANKY_MS ? 'janky' : null);

// The frame's longest script is named by where it starts in the app's own bundle, never by a function's name or an
// address outside it (an extension's, a plugin frame's).
export function frameFacts({ startTime, duration, blockingDuration, renderStart, scripts }: LongFrame, recent: number): AutoFrame {
  const sum = (read: (script: FrameScript) => number) => Math.round(scripts.reduce((total, script) => total + read(script), 0));
  const longest = scripts.reduce<FrameScript | null>((most, script) => (most && most.duration >= script.duration ? most : script), null);
  const at = longest && ownScript(longest.sourceURL);
  const file = at != null && /^[\w.-]{1,100}\.js$/.test(at) ? at : null;
  return {
    ms: Math.round(duration),
    blocked: Math.round(blockingDuration),
    script: sum((script) => script.duration),
    forced: sum((script) => script.forcedStyleAndLayoutDuration),
    render: renderStart ? Math.round(startTime + duration - renderStart) : 0,
    scripts: scripts.length,
    own: longest && longest.sourceURL ? file !== null : null,
    place: file !== null && longest!.sourceCharPosition >= 0 ? `${file}:${longest!.sourceCharPosition}` : null,
    invoker: FRAME_INVOKERS.find((known) => known === longest?.invokerType) ?? null,
    recent: Math.round(recent),
  };
}

// long: a frame of LONG_MS, by its length. slow: a frame that makes the page slow, and which way.
export function watchFrames({ long, slow }: { long: (ms: number) => void; slow: (page: SlowPage, frame: AutoFrame) => void }) {
  if (!globalThis.PerformanceObserver?.supportedEntryTypes.includes(KIND)) return;
  stats = { count: 0, blocked: 0, worst: 0 };
  let recent: { at: number; blocked: number }[] = [];
  new PerformanceObserver((list) => {
    for (const frame of list.getEntries() as unknown as LongFrame[]) {
      stats = { count: stats!.count + 1, blocked: Math.round(stats!.blocked + frame.blockingDuration), worst: Math.max(stats!.worst, Math.round(frame.duration)) };
      recent = [...recent.filter(({ at }) => at >= frame.startTime - WINDOW_MS), { at: frame.startTime, blocked: frame.blockingDuration }];
      const blocked = recent.reduce((total, each) => total + each.blocked, 0);
      if (frame.duration >= LONG_MS) long(frame.duration);
      const page = slowness(frame.duration, blocked);
      if (page) slow(page, frameFacts(frame, blocked));
    }
  }).observe({ type: KIND, buffered: true });
}
