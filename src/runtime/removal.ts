import { without } from '../model/fields';
import type { Stored, Values } from '../model/kinds';
import { daysLeft, REMOVABLE, type Mark, type Removable } from '../model/library';
import { KINDS, parentKinds, type Kind, type Rule } from '../model/kinds';
import type { ApiResult } from './api';
import type { Files } from './files';
import { SCOPED } from './object-cache';
import { cutShare } from './share-link';
import type { ObjectRow, ObjectStore, Pin } from './store';

const KIND_NAMES = Object.keys(KINDS) as Kind[];

// Remove children before owners, in sequential depth rounds; parallelize only within a round.
// Interrupted removal leaves owners retryable. Keep shared files until runtime/files sweeps them.
// Plan and remove under the same timeline pin.
export async function planRemoval(store: ObjectStore, root: { kind: Kind; id: string }, pin: Pin): Promise<ApiResult<ObjectRow[][]>> {
  const pulled = await store.pull();
  if (pulled) return pulled;
  const rounds: ObjectRow[][] = [];
  const visit = async (object: ObjectRow): Promise<ApiResult<number>> => {
    const children: ObjectRow[] = [];
    const failed = KIND_NAMES.some((kind) => parentKinds(kind).includes(object.kind as Kind))
      ? await store.scan({ parent: object.id, metadata: true }, (row) => { children.push(row); }, pin)
      : null;
    if (failed) return failed;
    for (const kind of KIND_NAMES) {
      const rule: Rule = KINDS[kind];
      if (rule.owner?.kind !== object.kind) continue;
      const field = rule.owner.field;
      const owned = (value: unknown) => (value as Record<string, unknown> | undefined)?.[field] === object.id;
      // A chat's own kinds are held only while the chat is open: the feed is asked for every one of the kind.
      const scanned = SCOPED.has(kind) ? await store.scan({ kind }, (row, value) => { if (owned(value)) children.push(row); }, pin) : null;
      if (scanned) return scanned;
      if (!SCOPED.has(kind)) children.push(...store.list(kind).filter(({ value }) => owned(value)));
    }
    let round = 0;
    for (const child of children) {
      const result = await visit(child);
      if (!result.ok) return result;
      round = Math.max(round, result.data + 1);
    }
    (rounds[round] ??= []).push(object);
    return { ok: true, data: round };
  };
  const stored = store.get(root.kind, root.id);
  if (!stored) return { ok: false, error: 'gone' };
  const result = await visit(stored);
  return result.ok ? { ok: true, data: rounds } : result;
}

// Stable within each depth: entries retain their input order, while every owner follows its children.
export function orderOwned<T extends { kind: Kind }>(objects: T[]): T[] {
  return [...objects].sort((a, b) => ownershipDepth(b.kind) - ownershipDepth(a.kind));
}

export function ownershipDepth(kind: Kind): number {
  const { owner }: Rule = KINDS[kind];
  const owners = owner ? [owner.kind] : parentKinds(kind);
  return owners.length === 0 ? 0 : Math.max(...owners.map(ownershipDepth)) + 1;
}

async function removeOn(store: ObjectStore, root: { kind: Kind; id: string }, progress: (done: number, total: number) => void, pin: Pin): Promise<ApiResult<null>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const plan = await planRemoval(store, root, pin);
    if (!plan.ok) return plan;
    const total = plan.data.reduce((sum, round) => sum + round.length, 0);
    let done = 0;
    progress(done, total);
    let conflict = false;
    for (const round of plan.data) {
      const removed = await store.removeRows(round);
      if (!removed.ok) {
        if (removed.error !== 'conflict') return removed;
        conflict = true;
        break;
      }
      progress(done += round.length, total);
    }
    if (!conflict) return { ok: true, data: null };
  }
  return { ok: false, error: 'conflict' };
}

// at is when it was deleted; null brings it back, unless its removal has begun ('gone').
export function markDeleted<K extends Removable>(store: ObjectStore, kind: K, id: string, at: number | null): Promise<ApiResult<Stored<K>>> {
  return store.update(kind, id, (current) => (at === null ? (current.purging ? null : without(current, 'deleted')) : { ...current, deleted: at }) as Values[K] | null);
}

// Claim purging at the current rev before deleting children. Earlier restore wins; later restore is refused.
// Claims remain due so interrupted purges resume, never return to the trash.
async function purge(store: ObjectStore, kind: Removable, id: string, due: (value: Mark) => boolean, progress: (removed: number, total: number) => void): Promise<ApiResult<null>> {
  const claimed = await store.update(kind, id, (current) => (current.purging || due(current) ? { ...current, purging: true } : null));
  if (!claimed.ok) return claimed;
  // A character's links are cut before it goes: once the vault forgets a link, only 설정 can cut it. In 휴지통 they stay
  // live, as the character can still come back.
  for (const { value } of kind === 'character' ? store.children('share', id) : []) {
    const cut = await cutShare(store, value.share);
    if (!cut.ok) return cut;
  }
  return store.pinned((pin) => removeOn(store, { kind, id }, progress, pin));
}

export async function purgeNow(store: ObjectStore, files: Files, kind: Removable, id: string, progress: (removed: number, total: number) => void): Promise<ApiResult<null>> {
  const purged = await purge(store, kind, id, (value) => value.deleted !== undefined, progress);
  if (purged.ok) void files.sweep();
  return purged;
}

// The session runs it when it opens, on whichever device opens first. One that fails is tried again next time. A stop
// (the vault closing) lets the one under way finish and leaves the rest for next time.
export async function purgeExpired(store: ObjectStore, files: Files, now: number, signal: AbortSignal): Promise<void> {
  const due = (value: Mark) => value.deleted !== undefined && daysLeft(value, now) <= 0;
  let purged = false;
  for (const kind of REMOVABLE) {
    for (const { id, value } of store.list(kind)) {
      if (signal.aborted) break;
      if (value.purging || due(value)) purged = (await purge(store, kind, id, due, () => {})).ok || purged;
    }
  }
  if (purged && !signal.aborted) void files.sweep();
}
