import type { ApiFailure } from '../../runtime/api';

const PAUSE = 600;

export type SaveStatus = 'saving' | 'saved' | 'failed';
export type Write<T> = (patch: Partial<T>) => Promise<{ ok: true } | ApiFailure>;

const empty = (patch: object) => Object.keys(patch).length === 0;

// Written one save at a time: a store write retried on a conflict reapplies its patch, so two in flight could land out
// of order and an older value win.
export class SaveQueue<T extends object> {
  private pending: Partial<T> = {};
  private writing: Partial<T> | null = null;
  private chain: Promise<boolean> = Promise.resolve(true);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last: 'saved' | 'failed' | null = null;
  // A failed patch put back reads as failed until something is typed over it.
  private edited = false;
  private removing = false;
  // Its thing is removed, or its session closed: nothing is taken or kept to write after.
  private ended = false;

  constructor(
    private readonly write: Write<T>,
    private readonly changed: (failure?: ApiFailure) => void,
  ) {}

  get status(): SaveStatus | null {
    return this.writing || (this.edited && !empty(this.pending)) ? 'saving' : this.last;
  }

  get unsaved(): Partial<T> {
    return { ...this.writing, ...this.pending };
  }

  get busy(): boolean {
    return this.writing !== null || this.removing || !empty(this.pending);
  }

  // An invalid value, such as a blank name, is never saved, and takes back the one waiting; the caller shows it.
  change = (patch: Partial<T>, valid = true) => {
    if (this.ended) return;
    const next = { ...this.pending, ...patch };
    if (!valid) for (const field of Object.keys(patch)) delete next[field as keyof T];
    this.pending = next;
    this.edited = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), PAUSE);
    this.changed();
  };

  save = (patch: Partial<T>) => {
    this.change(patch);
    return this.flush();
  };

  // True once everything changed so far is stored.
  flush = (): Promise<boolean> => {
    clearTimeout(this.timer);
    this.chain = this.chain.then(() => this.step());
    return this.chain;
  };

  // Queue removal after all prior saves, never beside an in-flight write that could resurrect it.
  // Success ends the queue and drops later drafts; null means a failed save prevented removal.
  remove = <R extends { ok: boolean }>(task: () => Promise<R>): Promise<R | null> => {
    clearTimeout(this.timer);
    const removed = this.chain.then(async () => {
      if (!(await this.step())) return null;
      this.removing = true;
      const result = await task();
      this.removing = false;
      if (result.ok) this.end();
      else this.changed();
      return result;
    });
    this.chain = removed.then(() => true);
    return removed;
  };

  end = () => {
    clearTimeout(this.timer);
    this.pending = {};
    this.ended = true;
    this.changed();
  };

  private async step(): Promise<boolean> {
    const patch = this.pending;
    if (empty(patch)) return true;
    this.pending = {};
    this.writing = patch;
    this.edited = false;
    this.changed();
    const saved = await this.write(patch);
    this.writing = null;
    // Retry failed patches beneath newer typing. Timeline rewind drops both: whole-field patches were based on old state.
    if (!saved.ok && saved.error === 'timeline-changed') {
      this.pending = {};
      this.last = null;
      this.changed();
      return false;
    }
    this.last = saved.ok ? 'saved' : 'failed';
    if (!saved.ok && !this.ended) this.pending = { ...patch, ...this.pending };
    this.changed(saved.ok ? undefined : saved);
    return saved.ok;
  }
}

type SaveView<T> = { status: SaveStatus | null; unsaved: Partial<T> };
const IDLE: SaveView<object> = { status: null, unsaved: {} };

type Entry<T extends object> = { queue: SaveQueue<T>; view: SaveView<T>; write: Write<T>; failed: (failure: ApiFailure) => void };

// One session queue per object key, shared by every screen; reopen sees pending edits and saves after them.
// Retain while watched or dirty; orphaned failures toast once and drop.
// Own the sole beforeunload listener for queue/store unsent work.
export class Saves {
  private readonly queues = new Map<string, Entry<object>>();
  private readonly watchers = new Map<string, Set<() => void>>();
  private holds = 0;

  constructor(
    private readonly page: Pick<Window, 'addEventListener' | 'removeEventListener'>,
    private readonly unsent: () => number,
  ) {
    page.addEventListener('beforeunload', this.unload);
  }

  view<T extends object>(key: string): SaveView<T> {
    return this.queues.get(key)?.view ?? IDLE;
  }

  watch(key: string, listener: () => void): () => void {
    const watching = this.watchers.get(key) ?? new Set();
    this.watchers.set(key, watching.add(listener));
    return () => {
      watching.delete(listener);
      if (watching.size === 0) this.watchers.delete(key);
      this.settle(key);
    };
  }

  // write and failed are the asking screen's, which is the one showing the thing now.
  queue<T extends object>(key: string, write: Write<T>, failed: (failure: ApiFailure) => void): SaveQueue<T> {
    const open = this.queues.get(key) as Entry<T> | undefined;
    if (open) return Object.assign(open, { write, failed }).queue;
    const made: Entry<T> = { queue: new SaveQueue<T>((patch) => made.write(patch), (failure) => this.changed(key, entry, failure)), view: IDLE, write, failed };
    const entry = made as unknown as Entry<object>;
    this.queues.set(key, entry);
    return made.queue;
  }

  flush(key: string): Promise<boolean> {
    return this.queues.get(key)?.queue.flush() ?? Promise.resolve(true);
  }

  // Flush current changes without debounce before leaving. Return true only if stored by bound;
  // close drops leftovers such as saves waiting on an outage.
  settled(bound: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), bound)));
    const written = Promise.all([...this.queues.values()].map(({ queue }) => queue.flush())).then((done) => done.every(Boolean));
    return Promise.race([written, late]).finally(() => clearTimeout(timer));
  }

  // The session is over: what waits is dropped, since its store takes no more writes.
  close() {
    const open = [...this.queues.values()];
    this.queues.clear();
    this.page.removeEventListener('beforeunload', this.unload);
    for (const { queue } of open) queue.end();
  }

  private changed(key: string, entry: Entry<object>, failure?: ApiFailure) {
    if (this.queues.get(key) !== entry) return;
    if (failure) {
      entry.failed(failure);
      if (!this.watchers.has(key)) entry.queue.end();
    }
    entry.view = { status: entry.queue.status, unsaved: entry.queue.unsaved };
    for (const listener of this.watchers.get(key) ?? []) listener();
    this.settle(key);
  }

  private settle(key: string) {
    const entry = this.queues.get(key);
    if (!entry || this.watchers.has(key) || entry.queue.busy) return;
    this.queues.delete(key);
  }

  // Held by work that dies with the page, a backup, a restore or a reply streaming in it: the browser asks before the
  // tab goes.
  hold(): () => void {
    this.holds++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.holds--;
    };
  }

  private readonly unload = (event: BeforeUnloadEvent) => {
    const busy = [...this.queues.values()].filter(({ queue }) => queue.busy);
    if (busy.length === 0 && this.unsent() === 0 && this.holds === 0) return;
    event.preventDefault();
    for (const { queue } of busy) void queue.flush();
  };
}
