import type { StoreRead } from '../model/kinds';
import type { CacheState } from './object-cache';

export type StoreChange = { kind: string; id: string; parent: string | null };

// value is undefined for a body that did not open. Such an object is counted, never
// shown as if it were empty, and never overwritten. kind may be one a newer version wrote.
export type Held = { id: string; kind: string; parent: string | null; rev: number; value: unknown; pending?: number };

type Revisions = Pick<CacheState, 'heads' | 'revisions'>;

// Confirmed objects only. Pending writes never advance these revisions or enter the lookup indexes.
export class ObjectIndex {
  private readonly live = new Map<string, Held>();
  private readonly deleted = new Map<string, number>();
  private readonly byKind = new Map<string, Set<string>>();
  private readonly byParent = new Map<string, Map<string, Set<string>>>();
  private readonly heads = new Map<string, number>();
  private readonly revisions = new Map<string, number>();
  private unreadableCount = 0;

  get(id: string): Held | undefined { return this.live.get(id); }

  ids(kind: string, parent?: string): ReadonlySet<string> | undefined {
    return parent === undefined ? this.byKind.get(kind) : this.byParent.get(parent)?.get(kind);
  }

  deletedRevision(id: string): number | undefined { return this.deleted.get(id); }

  unreadable(): number { return this.unreadableCount; }

  entryHead(chat: string): number { return this.heads.get(chat) ?? 0; }

  revision(read: StoreRead): number {
    if ('id' in read) return this.live.get(read.id)?.rev ?? this.deleted.get(read.id) ?? 0;
    return this.revisions.get(JSON.stringify('list' in read ? { kind: read.kind, list: true } : { kind: read.kind, parent: read.parent })) ?? 0;
  }

  loadRevisions({ heads, revisions }: Revisions) {
    for (const [chat, head] of heads) this.heads.set(chat, head);
    for (const [read, rev] of revisions) this.revisions.set(read, rev);
  }

  snapshotRevisions(): Revisions {
    return { heads: [...this.heads], revisions: [...this.revisions] };
  }

  // A feed may omit the body of an unheld chat. Its revision still invalidates reads and advances its entry head.
  recordRevision({ kind, parent, rev }: StoreChange & { rev: number }) {
    for (const read of [{ kind, list: true }, ...(parent ? [{ kind, parent }] : [])]) {
      const key = JSON.stringify(read);
      this.revisions.set(key, Math.max(this.revisions.get(key) ?? 0, rev));
    }
    if (kind === 'entry' && parent) this.heads.set(parent, Math.max(this.heads.get(parent) ?? 0, rev));
  }

  // Every write takes the account's next rev, so one not above the rev held for the id is that write or an older
  // one arriving late. Also checked after a pulled body decrypts: a write can land while it opens.
  stale(id: string, rev: number): boolean {
    const known = this.live.get(id)?.rev ?? this.deleted.get(id);
    return known !== undefined && rev <= known;
  }

  hold(object: Held) {
    this.forget(object.id);
    this.deleted.delete(object.id);
    this.live.set(object.id, object);
    if (object.value === undefined) this.unreadableCount++;
    const kind = this.byKind.get(object.kind);
    if (kind) kind.add(object.id);
    else this.byKind.set(object.kind, new Set([object.id]));
    if (object.parent === null) return;
    let children = this.byParent.get(object.parent);
    if (!children) this.byParent.set(object.parent, (children = new Map()));
    const siblings = children.get(object.kind);
    if (siblings) siblings.add(object.id);
    else children.set(object.kind, new Set([object.id]));
  }

  drop(id: string, rev: number) {
    this.forget(id);
    this.deleted.set(id, rev);
  }

  // Releasing a chat forgets its bodies, not its observed revisions or deletions.
  forget(id: string) {
    const held = this.live.get(id);
    if (!held) return;
    if (held.value === undefined) this.unreadableCount--;
    const kind = this.byKind.get(held.kind)!;
    kind.delete(id);
    if (!kind.size) this.byKind.delete(held.kind);
    if (held.parent !== null) {
      const children = this.byParent.get(held.parent)!;
      const siblings = children.get(held.kind)!;
      siblings.delete(id);
      if (!siblings.size) children.delete(held.kind);
      if (!children.size) this.byParent.delete(held.parent);
    }
    this.live.delete(id);
  }

  clear() {
    this.live.clear();
    this.deleted.clear();
    this.byKind.clear();
    this.byParent.clear();
    this.heads.clear();
    this.revisions.clear();
    this.unreadableCount = 0;
  }
}
