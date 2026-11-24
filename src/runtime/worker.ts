import type { AutoUnit } from '../contracts/auto-diagnosis';
import { onProgress } from '../engine/progress';

type Policy = { createScriptURL(url: string): string };

// The CSP requires Trusted Types for script URLs. This policy is never exported: it signs only a URL handed to
// moduleWorker, whose callers pass their bundled `?worker&url` import.
const workers = new Set<string>();
const policy = (globalThis as { trustedTypes?: { createPolicy(name: string, rules: Policy): Policy } }).trustedTypes?.createPolicy('module-worker', {
  createScriptURL: (url) => {
    if (!workers.has(url)) throw new TypeError('not a bundled worker');
    return url;
  },
});

export function moduleWorker(url: string): Worker {
  workers.add(url);
  return new Worker((policy?.createScriptURL(url) ?? url) as string, { type: 'module' });
}

const BEAT_MS = 1000;
// A sign goes at most this often, so the unit a page holds began at most this much work before the one running, and
// a unit that took this long is named with its time as it ends. Posting this seldom never slows a long pass.
const SIGN_MS = 50;

// unit: the one about to begin, null once a job's last has ended. ended: the units that ended since the last sign.
// slow: the one that just ended, when it took SIGN_MS.
export type Sign = { unit: AutoUnit | null; ended: number; slow: (AutoUnit & { ms: number }) | null };

// Inside a worker: the engine's signs of life (engine/progress). Returns what a job tells of itself. begins: no unit
// is running, so the time to the next sign is no unit's and nothing counted before is this job's. ends: its last
// unit has ended, which no next unit would tell.
export function postProgress(post: (sign: Sign) => void) {
  let last = -Infinity;
  let ended = 0;
  // The running unit's fields apart, so a sign that is not posted makes no object.
  let began: number | null = null;
  let [kind, message, script, chars, stage]: Parameters<Parameters<typeof onProgress>[0]> = ['message', null, null, null, null];
  const unit = (): AutoUnit => ({ kind, stage, message, script, chars });
  // A slow unit began no earlier than the last sign, so a sign is always due as it ends.
  const end = (now: number) => {
    if (began === null) return null;
    ended++;
    const took = now - began;
    return took >= SIGN_MS ? { ...unit(), ms: Math.round(took) } : null;
  };
  const begins = () => {
    began = null;
    ended = 0;
    last = -Infinity;
  };
  onProgress((...next) => {
    const now = performance.now();
    const slow = end(now);
    [kind, message, script, chars, stage] = next;
    began = now;
    if (now - last < SIGN_MS) return;
    last = now;
    post({ unit: unit(), ended, slow });
    ended = 0;
  });
  return {
    begins,
    ends() {
      const slow = end(performance.now());
      if (ended) post({ unit: null, ended, slow });
      begins();
    },
  };
}

// Judge unanswered pings, never elapsed wall time alone: hidden tabs delay timers.
// If a visible page's own beat was late, ping again rather than blame a worker answer waiting behind the stall.
export class Heartbeat {
  private beat: ReturnType<typeof setInterval> | null = null;
  private pinged: number | null = null;
  private last: number | null = null;
  private limit = 0;

  constructor(private readonly ping: () => void, private readonly stuck: () => void) {}

  // A page frozen in the background (Chrome on Android) freezes its workers with it: the ping that waited out the
  // freeze is asked again. resume fires before the frozen timers run.
  private readonly thaw = () => {
    this.pinged = null;
  };

  // limit: for the job running now, which may differ from the one before it.
  start(limit: number) {
    this.limit = limit;
    if (this.beat) return;
    this.beat = setInterval(() => this.check(), BEAT_MS);
    globalThis.document?.addEventListener('resume', this.thaw);
  }

  answered() {
    this.pinged = null;
  }

  rest() {
    if (this.beat) clearInterval(this.beat);
    globalThis.document?.removeEventListener('resume', this.thaw);
    this.beat = null;
    this.pinged = null;
    this.last = null;
  }

  private check() {
    const now = Date.now();
    const late = this.last !== null && now - this.last > 2 * BEAT_MS && globalThis.document?.visibilityState !== 'hidden';
    this.last = now;
    if (this.pinged !== null && !late) {
      if (now - this.pinged > this.limit) this.stuck();
      return;
    }
    this.pinged = now;
    this.ping();
  }
}
