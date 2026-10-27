import type { Kind, Stored } from '../model/kinds';
import { SCOPED } from './object-cache';
import type { Held, ObjectIndex } from './object-index';
import type { Pending } from './object-writes';

// Overlay unanswered writes (held null removes) without inventing revisions.
// Indexes, pull cursors and cache bounds remain confirmed-only (user, 2026-10-04).
export type Overlay = { id: string; kind: string; parent: string | null; held: Held | null };
export const chatOf = ({ id, kind, parent }: Overlay) => kind === 'chat' ? id : SCOPED.has(kind) ? parent : null;

export type PendingCommit = {
  readonly blocked: boolean;
  readonly visible: number;
  wait(stop: AbortSignal): Promise<boolean>;
  show(pending: Pending): Overlay;
  unshow(id: string): Overlay | null;
  hide(): Overlay[];
  release(): void;
};

// false when stop ends the wait first.
async function waited(work: Promise<unknown>, stop: AbortSignal): Promise<boolean> {
  if (stop.aborted) return false;
  let quit = () => {};
  const stopped = new Promise<false>((resolve) => {
    quit = () => resolve(false);
    stop.addEventListener('abort', quit, { once: true });
  });
  try { return await Promise.race([work.then(() => true as const), stopped]); }
  finally { stop.removeEventListener('abort', quit); }
}

export class PendingWrites {
  private readonly overlays = new Map<string, Overlay>();
  private readonly marks = new Map<string, number>();
  private shownCount = 0;
  // Per id, the commit last called to write it: a later one sends only once the earlier has ended, so writes to one
  // object land in call order and a later overlay is never replaced by an earlier answer.
  private readonly claims = new Map<string, Promise<void>>();
  private readonly unsent = new Set<() => number>();

  constructor(private readonly objects: ObjectIndex) {}

  shown(id: string): Held | undefined {
    const overlay = this.overlays.get(id);
    return overlay ? overlay.held ?? undefined : this.objects.get(id);
  }

  parent(id: string): string | null | undefined {
    return (this.overlays.get(id) ?? this.objects.get(id))?.parent;
  }

  shownOf<K extends Kind>(ids: ReadonlySet<string> | undefined, matches: (held: Held) => boolean): Stored<K>[] {
    const shown: Held[] = [];
    for (const id of ids ?? []) {
      const held = this.shown(id);
      if (held && matches(held)) shown.push(held);
    }
    for (const { id, held } of this.overlays.values()) if (held && !ids?.has(id) && matches(held)) shown.push(held);
    return shown.filter((held): held is Stored<K> => held.value !== undefined);
  }

  mark(chat: string): number { return this.marks.get(chat) ?? 0; }

  showing(chat: string): boolean {
    for (const overlay of this.overlays.values()) if (chatOf(overlay) === chat) return true;
    return false;
  }

  readonly count = () => {
    let count = 0;
    for (const unsent of this.unsent) count += unsent();
    return count;
  };

  dropUnsent(): number {
    const count = this.count();
    this.unsent.clear();
    return count;
  }

  begin(ids: string[], remaining: () => number): PendingCommit {
    this.unsent.add(remaining);
    const unique = [...new Set(ids)];
    const earlier = unique.flatMap((id) => this.claims.get(id) ?? []);
    let release = () => {};
    const completed = new Promise<void>((resolve) => { release = resolve; });
    // A commit stopped while it waits ends only its own turn: its claim settles once the writes ahead of it have too,
    // for a later writer already waiting and for one that arrives after the stop.
    const claim = earlier.length ? Promise.all([...earlier, completed]).then(() => {}) : completed;
    for (const id of unique) this.claims.set(id, claim);
    void claim.then(() => {
      for (const id of unique) if (this.claims.get(id) === claim) this.claims.delete(id);
    });
    const shown = new Map<string, Overlay>();
    const unshow = (id: string): Overlay | null => {
      const overlay = shown.get(id);
      shown.delete(id);
      // Only this commit's overlay goes: a later write's stays until its own answer.
      if (!overlay || this.overlays.get(id) !== overlay) return null;
      this.overlays.delete(id);
      this.marked(overlay);
      return overlay;
    };
    return {
      blocked: earlier.length > 0,
      get visible() { return shown.size; },
      wait: (stop) => waited(Promise.all(earlier), stop),
      show: ({ id, kind, parent, value }) => {
        const held = value === undefined ? null : { id, kind, parent, value, rev: this.objects.get(id)?.rev ?? 0, pending: ++this.shownCount };
        const overlay = { id, kind, parent, held };
        this.overlays.set(id, overlay);
        shown.set(id, overlay);
        this.marked(overlay);
        return overlay;
      },
      unshow,
      hide: () => [...shown.keys()].flatMap((id) => unshow(id) ?? []),
      release: () => {
        this.unsent.delete(remaining);
        release();
      },
    };
  }

  private marked(overlay: Overlay) {
    const chat = chatOf(overlay);
    if (chat) this.marks.set(chat, ++this.shownCount);
  }

  close() { this.overlays.clear(); }
}
