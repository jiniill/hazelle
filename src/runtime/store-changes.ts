import type { StoreChange, StoreRead } from './object-index';

export const readsChanged = (reads: StoreRead[], changes: readonly StoreChange[]) =>
  reads.some((read) => changes.some((change) => read.kind === change.kind && ('list' in read || ('id' in read ? read.id === change.id : read.parent === change.parent))));

export class StoreChanges {
  private readonly listeners = new Set<(changes: readonly StoreChange[]) => void>();
  private readonly changes: StoreChange[] = [];
  private reading: StoreRead[] | null = null;

  readonly subscribe = (listener: (changes: readonly StoreChange[]) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  read(read: StoreRead) { this.reading?.push(read); }

  add(change: StoreChange) { this.changes.push(change); }

  // Capture is synchronous: every missing read counts too, so a later create invalidates it.
  capture<T>(read: () => T): { value: T; reads: StoreRead[] } {
    const previous = this.reading;
    const reads: StoreRead[] = [];
    this.reading = reads;
    try {
      return { value: read(), reads };
    } finally {
      this.reading = previous;
      previous?.push(...reads);
    }
  }

  // Evaluation bookkeeping must not become a dependency of the display that asked for it.
  unrecorded<T>(read: () => T): T {
    const previous = this.reading;
    this.reading = null;
    try { return read(); }
    finally { this.reading = previous; }
  }

  publish() {
    if (!this.changes.length) return;
    // A confirmed write is told twice over, by hold and by its overlay going.
    const changes = [...new Map(this.changes.splice(0).map((change) => [`${change.kind}\n${change.id}\n${change.parent}`, change])).values()];
    // Publishing sits inside pulls and writes, before their cursor moves or their answer returns: a listener's fault
    // goes on as an uncaught error (runtime/diagnostics hears it), never through the store's work or past later listeners.
    for (const listener of this.listeners) {
      try {
        listener(changes);
      } catch (error) {
        queueMicrotask(() => { throw error; });
      }
    }
  }

  close() { this.listeners.clear(); }
}
