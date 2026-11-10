import { ChangeSignal } from '../../change-signal';

// Held until set: a snapshot that is a fresh value on every read would make React re-render forever.
export class Snapshot<T> {
  private readonly changes = new ChangeSignal();
  constructor(private value: T) {}
  readonly snapshot = () => this.value;
  readonly subscribe = this.changes.subscribe;
  set(value: T) {
    if (value === this.value) return;
    this.value = value;
    this.changes.notify();
  }
}

// Each put is a new map, even one deleting an absent key, so every put tells its listeners.
export class KeyedSnapshot<V> extends Snapshot<ReadonlyMap<string, V>> {
  constructor() {
    super(new Map());
  }

  put(key: string, entry: V | null) {
    const next = new Map(this.snapshot());
    if (entry) next.set(key, entry);
    else next.delete(key);
    this.set(next);
  }
}
