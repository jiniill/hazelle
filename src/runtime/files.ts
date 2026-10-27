import { isRecord } from '../connectors/values';
import { FILE_ID, MAX_FILE_IDS, type MissingFiles } from '../contracts/files';
import { FILE_KINDS } from '../model/kinds';
import { fileId, openFile, sealFile, type FileRef } from '../vault/files';
import type { ApiFailure, ApiResult } from './api';
import type { Backend } from './backend';
import type { ObjectStore } from './store';

type Missing = Omit<MissingFiles, 'missing'> & { missing: Set<string> };

// How many transfers of stored files this page runs at once, reads and uploads together: over HTTP/1.1 a browser opens 6
// connections to a host, which the store and replies need too. runtime/api's SLOWEST_UPLOAD assumes the larger sharing
// one uplink.
export const TRANSFERS = { multiplexed: 24, http1: 4 } as const;
// What a run of transfers holds started and not yet taken (inOrder): a phone's memory sets it, not the speed.
export const HELD_AHEAD = 64 * 1024 * 1024;
const SWEEP_TRIES = 3;
const REFUSED = new Set(['too-large', 'file-blocked', 'files-full']);

// Plain http is always HTTP/1.1; behind https a browser that names no protocol is taken to multiplex.
export function transferSlots(protocol: string, nextHop: string | undefined): number {
  return protocol === 'https:' && nextHop !== 'http/1.1' ? TRANSFERS.multiplexed : TRANSFERS.http1;
}

// Release each transfer slot immediately; never wait for a whole batch's slowest file.
// Foreground pictures outrank bulk backup/import/export work.
export class Transfers {
  private running = 0;
  private readonly waiting = { now: [] as (() => void)[], bulk: [] as (() => void)[] };

  constructor(readonly slots: number) {}

  async run<T>(work: () => Promise<T>, bulk = false): Promise<T> {
    if (this.running < this.slots) this.running++;
    else await new Promise<void>((resolve) => this.waiting[bulk ? 'bulk' : 'now'].push(resolve));
    try {
      return await work();
    } finally {
      const next = this.waiting.now.shift() ?? this.waiting.bulk.shift();
      if (next) next();
      else this.running--;
    }
  }
}

const navigation = typeof performance === 'undefined' ? undefined : (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined);
export const transfers = new Transfers(transferSlots(globalThis.location?.protocol ?? '', navigation?.nextHopProtocol));

// Prefetch up to ahead items and HELD_AHEAD known bytes, always allowing the first. Yield in input order;
// early exit must still await transfers already started.
export async function* inOrder<T, R>(items: readonly T[], start: (item: T) => Promise<R>, { ahead = TRANSFERS.multiplexed, size = () => 0 }: { ahead?: number; size?: (item: T) => number } = {}): AsyncGenerator<[T, R]> {
  const started: Promise<R>[] = [];
  let next = 0;
  let held = 0;
  try {
    for (const item of items) {
      while (next < items.length && started.length < ahead && (started.length === 0 || held + size(items[next]!) <= HELD_AHEAD)) {
        held += size(items[next]!);
        const run = start(items[next++]!);
        // Awaited only once it is the head: one failing before then (a closed worker) must not read as unhandled.
        run.catch(() => {});
        started.push(run);
      }
      const result = await started.shift()!;
      held -= size(item);
      yield [item, result];
    }
  } finally {
    await Promise.allSettled(started);
  }
}

export const namedFile = (value: unknown): string | null => (isRecord(value) && isRecord(value.file) && typeof value.file.id === 'string' && FILE_ID.test(value.file.id) ? value.file.id : null);

// Content-sealed files deduplicate within an account, never across accounts (server/files.ts).
// All requests retry dropped connections through store.reaching; reads/uploads also take a page transfer slot.
export class Files {
  private sweeping: Promise<void> | null = null;
  private owed = false;

  constructor(
    private readonly backend: Backend,
    private readonly store: ObjectStore,
    private readonly queue: Transfers = transfers,
  ) {}

  // Keep result order; null files are refused (size/block/cap) and must be omitted and counted by the caller.
  async save(files: Uint8Array<ArrayBuffer>[], { signal, bulk }: { signal?: AbortSignal; bulk?: boolean } = {}): Promise<ApiResult<(FileRef | null)[]>> {
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    const sealed = await Promise.all(files.map(sealFile));
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    const bodies = new Map(sealed.map(({ ref, body }) => [ref.id, body]));
    const asked = await this.missing([...bodies.keys()]);
    if (!asked.ok) return asked;
    const refused = new Set<string>();
    const missing: string[] = [];
    let room = asked.data.room;
    for (const id of asked.data.missing) {
      const size = bodies.get(id)!.length;
      if (size > asked.data.maxBytes || (room !== null && size > room)) refused.add(id);
      else {
        missing.push(id);
        if (room !== null) room -= size;
      }
    }
    let failed: ApiFailure | undefined;
    await Promise.all(
      missing.map((id) =>
        this.queue.run(async () => {
          if (failed || signal?.aborted) return;
          const put = await this.store.reaching(() => this.backend.putFile(id, bodies.get(id)!), signal);
          if (put.ok) return;
          if (REFUSED.has(put.error)) refused.add(id);
          else failed ??= put;
        }, bulk),
      ),
    );
    if (signal?.aborted) return { ok: false, error: 'stopped' };
    if (failed) return failed;
    return { ok: true, data: sealed.map(({ ref }) => (refused.has(ref.id) ? null : ref)) };
  }

  // The ids the server holds no readable file for (never stored, or blocked), the largest sealed body it takes and the
  // bytes left under the account's picture cap.
  async missing(ids: string[]): Promise<ApiResult<Missing>> {
    const missing = new Set<string>();
    let maxBytes = 0;
    let room: number | null = null;
    for (let start = 0; start < ids.length; start += MAX_FILE_IDS) {
      const asked = await this.store.reaching(() => this.backend.missingFiles(ids.slice(start, start + MAX_FILE_IDS)));
      if (!asked.ok) return asked;
      for (const id of asked.data.missing) missing.add(id);
      ({ maxBytes, room } = asked.data);
    }
    return { ok: true, data: { missing, maxBytes, room } };
  }

  // Sweep after permanent removal; coalesce another removal into one more pass.
  // Failures leave bytes counted until a later sweep; writes during a walk invalidate it and require retry.
  sweep(): Promise<void> {
    this.owed = true;
    this.sweeping ??= (async () => {
      while (this.owed) {
        this.owed = false;
        for (let tries = 1; ; tries++) {
          const swept = await this.release();
          if (swept.ok || swept.error !== 'conflict' || tries === SWEEP_TRIES) break;
        }
      }
    })().finally(() => (this.sweeping = null));
    return this.sweeping;
  }

  // Include binned objects' references; unreadable rows or missing file refs must abort release, not look unused.
  // Inventory first excludes uploads arriving mid-walk. The server checks its object revision on the account queue,
  // invalidating the unused set if any object was written during the walk.
  async release(signal?: AbortSignal): Promise<ApiResult<{ released: number; taken: number }>> {
    return this.store.pinned(async (pin): Promise<ApiResult<{ released: number; taken: number }>> => {
      const held: string[] = [];
      let rev: number | null = null;
      for (let more = true; more; ) {
        const after = held.at(-1);
        const page = await this.store.reaching(() => this.backend.heldFiles(after ?? null), signal);
        if (!page.ok) return page;
        if (page.data.timeline !== pin.timeline) return { ok: false, error: 'cache-reset' };
        if (rev !== null && rev !== page.data.rev) return { ok: false, error: 'conflict' };
        rev = page.data.rev;
        held.push(...page.data.ids);
        ({ more } = page.data);
      }
      const named = new Set<string>();
      let whole = true;
      for (const kind of FILE_KINDS) {
        const failure = await this.store.scan({ kind }, (_, value) => {
          const id = namedFile(value);
          if (id === null) whole = false;
          else named.add(id);
        }, pin, signal);
        if (failure) return failure;
        if (!whole) return { ok: false, error: 'unreadable' };
      }
      const holds = new Set(held);
      const unused = held.filter((id) => !named.has(id));
      const lost = [...named].filter((id) => !holds.has(id));
      const swept = { released: 0, taken: 0 };
      for (let start = 0; start < lost.length + unused.length; start += MAX_FILE_IDS) {
        const named = lost.slice(start, start + MAX_FILE_IDS);
        const released = unused.slice(Math.max(0, start - lost.length), Math.max(0, start + MAX_FILE_IDS - lost.length));
        // rev: set by the walk's first page, which always comes.
        const body = { timeline: pin.timeline, rev: rev!, unused: released, named };
        const answer = await this.store.reaching(() => this.backend.sweepFiles(body), signal);
        if (!answer.ok) return answer;
        swept.released += answer.data.released;
        swept.taken += answer.data.taken;
      }
      return { ok: true, data: swept };
    }, signal);
  }

  // A body sealed elsewhere, a share's manifest, stored as it is under its hash, as every file is. Its id.
  async put(body: Uint8Array<ArrayBuffer>): Promise<ApiResult<string>> {
    const id = await fileId(body);
    const put = await this.queue.run(() => this.store.reaching(() => this.backend.putFile(id, body)));
    return put.ok ? { ok: true, data: id } : put;
  }

  // A body that does not open answers 'unreadable', never empty bytes. The wait ends with signal (a backup's 중지), not
  // only with the store.
  async read(ref: FileRef, { signal, bulk }: { signal?: AbortSignal; bulk?: boolean } = {}): Promise<ApiResult<Uint8Array<ArrayBuffer>>> {
    const result = await this.queue.run(() => this.store.reaching(() => this.backend.readFile(ref.id), signal), bulk);
    if (!result.ok) return result;
    const bytes = await openFile(ref, result.data);
    return bytes ? { ok: true, data: bytes } : { ok: false, error: 'unreadable' };
  }
}

export const PERMANENT = new Set(['not-found', 'unreadable']);
