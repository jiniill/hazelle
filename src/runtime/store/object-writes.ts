import { FILE_KINDS, KINDS, parentKinds, type AppendOnly, type Kind, type Singleton, type Stored, type Values } from '../../model/kinds';
import type { SealedWrite } from '../../contracts/objects';
import type { ApiResult } from '../api';
import { namedFile } from '../files/files';
import { orderOwned } from '../library/removal';
import { SCOPED, WALKED, type CacheState } from './object-cache';
import { CodecAborted, type ObjectCodec, SEAL_ITEMS } from './object-codec';
import { codecValue, type SealItem } from './object-codec-core';
import type { Held, ObjectIndex, StoreChange } from './object-index';

export type Limits = NonNullable<CacheState['limits']>;
type ObjectValue = Omit<Stored<Kind>, 'rev' | 'pending'>;
// rewrite: the object written back as it is held then (runtime/store/upgrade's write-back).
type Put = ObjectValue & { type: 'create' | 'restore' };
export type Write = Put | { type: 'remove'; id: string } | { type: 'rewrite'; id: string };
export type Pending = { id: string; kind: string; parent: string | null; value: unknown; baseRev: number | null };
export type Resolved = { pending: Pending | null; held: Held | null };
// derived: a write the store makes on its own (a summary, a rewrite) or the app makes unasked (the minutes present), which is
// not counted among the person's dropped writes nor asked about on leaving, and not shown before its answer. at: the copy
// a change applies to, live when sent and what reads show when previewed.
export type WriteStep = { id: string; resolve: (at: (id: string) => Held | undefined) => ApiResult<Resolved>; derived?: boolean };

type Prepared = { resolved: Resolved[]; writes: SealedWrite[]; files: string[] };

const encoder = new TextEncoder();
const DERIVED: ReadonlySet<Kind> = new Set(['summary', 'presence']);
const isPut = (write: Write): write is Put => write.type === 'create' || write.type === 'restore';

export class ObjectWrites {
  constructor(private readonly objects: ObjectIndex, private readonly codec: ObjectCodec) {}

  arrange(writes: Write[], unheld: boolean) {
    const ordered = [...orderOwned(writes.filter(isPut)), ...writes.filter((write) => !isPut(write))];
    const chats = new Set<string>();
    const created = new Set<string>();
    for (const write of unheld ? [] : ordered) {
      if (write.type === 'remove' || write.type === 'rewrite') {
        const held = this.objects.get(write.id);
        if (held && SCOPED.has(held.kind) && held.parent) chats.add(held.parent);
      } else if (write.kind === 'chat') {
        chats.add(write.id);
        if (write.type === 'create') created.add(write.id);
      } else if (SCOPED.has(write.kind) && write.parent) chats.add(write.parent);
    }
    return { ordered, chats: [...chats].map((chat) => ({ chat, created: created.has(chat) })) };
  }

  update<K extends Exclude<Kind, AppendOnly>>(kind: K, id: string, change: (current: Values[K]) => Values[K] | null): WriteStep {
    return { id, derived: DERIVED.has(kind), resolve: (at) => {
      const held = at(id);
      if (!held || held.kind !== kind) return { ok: false, error: SCOPED.has(kind) ? 'not-loaded' : 'gone' };
      if (held.value === undefined) return { ok: false, error: 'unreadable' };
      const value = change(held.value as Values[K]);
      if (value === null) return { ok: false, error: 'gone' };
      return { ok: true, data: { pending: { kind, id, parent: held.parent, value, baseRev: held.rev }, held: null } };
    } };
  }

  upsert<K extends Singleton>(kind: K, change: (current: Values[K] | undefined) => Values[K]): WriteStep {
    const id = KINDS[kind].id;
    return { id, resolve: (at) => {
      const held = at(id);
      if (held && held.value === undefined) return { ok: false, error: 'unreadable' };
      return { ok: true, data: { pending: { kind, id, parent: null, value: change(held?.value as Values[K] | undefined), baseRev: held?.rev ?? null }, held: null } };
    } };
  }

  remove(row: StoreChange & { rev: number }): WriteStep {
    return { id: row.id, resolve: (at) => {
      const held = at(row.id);
      if (!held && (this.objects.deletedRevision(row.id) ?? 0) >= row.rev) return { ok: true, data: { pending: null, held: null } };
      return { ok: true, data: { pending: { ...row, value: undefined, baseRev: held?.rev ?? row.rev }, held: null } };
    } };
  }

  step(write: Write): WriteStep {
    return {
      id: write.id,
      derived: write.type === 'rewrite' || (isPut(write) && DERIVED.has(write.kind)),
      resolve: (at) => {
        const held = at(write.id);
        // One gone, not loaded or unreadable by then has nothing to write back, and does not fail the others.
        if (write.type === 'rewrite') return { ok: true, data: { pending: held && held.value !== undefined ? { ...held, baseRev: held.rev } : null, held: null } };
        if (write.type === 'remove') {
          if (!held && this.objects.deletedRevision(write.id) === undefined) return { ok: false, error: 'not-loaded' };
          return { ok: true, data: { pending: held ? { ...held, value: undefined, baseRev: held.rev } : null, held: null } };
        }
        const { id, kind, parent, value } = write;
        if (!this.fits(kind, parent)) return { ok: false, error: 'bad-input' };
        if (write.type === 'create' && held) {
          const landed = held.kind === kind && held.parent === parent && JSON.stringify(held.value) === JSON.stringify(value);
          return landed ? { ok: true, data: { pending: null, held } } : { ok: false, error: 'conflict' };
        }
        if (held && held.value === undefined) return { ok: false, error: 'unreadable' };
        const baseRev = write.type === 'create' ? null : held?.rev ?? this.objects.deletedRevision(id) ?? null;
        return { ok: true, data: { pending: { id, kind, parent, value, baseRev }, held: null } };
      },
    };
  }

  // A parent this store has not seen passes: addCharacter writes a character's lore and avatar before
  // the character itself.
  private fits(kind: Kind, parent: string | null): boolean {
    const kinds = parentKinds(kind);
    if (kinds.length === 0 || parent === null) return kinds.length === 0 && parent === null;
    const held = this.objects.get(parent);
    return !held || kinds.includes(held.kind as Kind);
  }

  async prepare(steps: WriteStep[], { start, end, limits, timeline, signal }: { start: number; end: number; limits: Limits; timeline: string; signal: AbortSignal }): Promise<ApiResult<Prepared>> {
    const resolved: Resolved[] = [];
    const writes: SealedWrite[] = [];
    const files = new Set<string>();
    let bytes = encoder.encode(JSON.stringify({ timeline, writes: [], files: [] })).length;
    // Resolve and seal afresh INSIDE every retry. Keep only a small value window, not the server's entire
    // item page. Future failures stay in their slots until the byte-limited prefix reaches them.
    filling: for (let from = start; from < end; from += SEAL_ITEMS) {
      if (signal.aborted) throw new CodecAborted('Object batch stopped');
      const window = steps.slice(from, Math.min(from + SEAL_ITEMS, end)).map((step) => {
        try { return { ready: step.resolve((id) => this.objects.get(id)) }; }
        catch (error) { return { error }; }
      });
      const items: SealItem[] = [];
      const slots = new Map<number, number>();
      for (const [index, entry] of window.entries()) {
        const pending = entry.ready?.ok ? entry.ready.data.pending : null;
        if (!pending || pending.value === undefined) continue;
        slots.set(index, items.length);
        items.push(pending);
      }
      const sealed = items.length ? await this.codec.seal(items, limits.body, signal) : [];
      for (const [index, entry] of window.entries()) {
        if (!entry.ready) throw entry.error;
        const ready = entry.ready;
        if (!ready.ok) return ready;
        const { pending } = ready.data;
        if (pending) {
          const { id, kind, parent, baseRev, value } = pending;
          const body = value === undefined ? null : codecValue(sealed[slots.get(index)!]!);
          if (value !== undefined && body === null) return { ok: false, error: 'too-large' };
          let file: string | null = null;
          if (value !== undefined && FILE_KINDS.includes(kind as Kind)) {
            file = namedFile(value);
            if (file === null) return { ok: false, error: 'unreadable' };
          }
          // A walked row is never held, so a create sent again after its lost answer cannot find it here: the server
          // answers it as landed (server/account-store once).
          const write = { id, kind, parent, baseRev, body, ...(WALKED.has(kind) && baseRev === null && { once: true as const }) };
          const size = encoder.encode(JSON.stringify(write)).length + (writes.length ? 1 : 0) + (file !== null && !files.has(file) ? file.length + 3 : 0);
          if (bytes + size > limits.bytes) {
            if (!resolved.length) return { ok: false, error: 'too-large' };
            break filling;
          }
          bytes += size;
          writes.push(write);
          if (file !== null) files.add(file);
        }
        resolved.push(ready.data);
      }
    }
    return { ok: true, data: { resolved, writes, files: [...files] } };
  }
}
