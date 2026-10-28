import { CLAIM_SETTLE_MS, MAX_FILE_BYTES, MAX_FILE_IDS } from '../contracts/files';
import { BATCH_LIMITS, type BatchAnswer, type FeedAnswer, type FeedQuery, type SealedChange, type SealedWrite } from '../contracts/objects';
import { randomBytes } from '../vault/aead';
import { recallGuest, rememberVault } from '../vault/device';
import type { VaultKey } from '../vault/keys';
import type { ApiFailure, ApiResult } from './api';
import type { Backend } from './backend';
import { database } from './device-cache';
import { UNFED } from './object-cache';

// Browser is the guest's master, not a cache. Match server object/file API semantics, including revisions,
// conflicts, once, omitted bodies, page limits and revision-checked sweeps; each call is one IndexedDB transaction.

type Head = { rev: number; timeline: string; boardSecret?: string };
// scope: '' for a kind the feed carries, its parent for one it omits (object-cache UNFED), so a bootstrap reads past
// every message without opening it.
type Row = { account: string; id: string; kind: string; parent: string | null; rev: number; body: string | null; scope: string };
type HeldFile = { body: Uint8Array<ArrayBuffer>; claimed: number };

const PAGE_ROWS = 500;
const METADATA_PAGE_ROWS = 10_000;
const PAGE_BODY_BYTES = 4_000_000;

const failure = (error: string): ApiFailure => ({ ok: false, error });
const RESET = failure('cache-reset');

// The guest this browser holds, made at its first use: an account id and a vault key no server has seen, kept as
// 잠금 유지 keeps an account's (vault/device).
export async function guestAccount(): Promise<{ accountId: string; vaultKey: VaultKey }> {
  return navigator.locks.request('risu-alpha/guest', async () => {
    const held = await recallGuest();
    if (held) return held;
    const accountId = crypto.randomUUID();
    const vaultKey = randomBytes(32);
    // The head first: a page closed between the two leaves a head nobody names, never a vault without its store.
    const head = await transact(['guest-heads'], 'readwrite', async (tx) => {
      tx.objectStore('guest-heads').put({ rev: 0, timeline: crypto.randomUUID() } satisfies Head, accountId);
      return { ok: true, data: null };
    });
    if (!head.ok) throw new Error(head.error);
    await rememberVault(accountId, vaultKey, true);
    await navigator.storage?.persist?.().catch(() => false);
    return { accountId, vaultKey };
  });
}

// Kept beside the sealed objects, never in their feed or an account upload. A transaction makes all tabs share it.
export async function guestBoardSecret(account: string, create = false): Promise<ApiResult<string | null>> {
  return transact(['guest-heads'], 'readwrite', async (tx) => {
    const head = await headOf(tx, account);
    if (!head) return failure('browser-storage');
    if (!head.boardSecret && create) {
      head.boardSecret = Array.from(randomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
      tx.objectStore('guest-heads').put(head, account);
    }
    return { ok: true, data: head.boardSecret ?? null };
  });
}

export async function clearGuestStore(account: string, expected?: { timeline: string; rev: number; files: string[] }): Promise<ApiResult<null>> {
  return transact(['guest-heads', 'guest-objects', 'guest-files'], 'readwrite', async (tx) => {
    const head = await headOf(tx, account);
    if (expected && (!head || head.timeline !== expected.timeline || head.rev !== expected.rev)) return failure('conflict');
    const range = IDBKeyRange.bound([account], [account, []]);
    if (expected) {
      const keys = await got<IDBValidKey[]>(tx.objectStore('guest-files').getAllKeys(range));
      if (keys.length !== expected.files.length || keys.some((key, index) => (key as [string, string])[1] !== expected.files[index])) return failure('conflict');
    }
    tx.objectStore('guest-objects').delete(range);
    tx.objectStore('guest-files').delete(range);
    // Keep an empty head until the vault mark is removed in the other database: a close between the two cleanups
    // can still resume. The new timeline also fences a guest tab that was open before the transfer.
    tx.objectStore('guest-heads').put({ rev: 0, timeline: crypto.randomUUID() } satisfies Head, account);
    return { ok: true, data: null };
  });
}

export function guestBackend(account: string): Backend {
  const objectKey = (id: string) => [account, id];
  return {
    feed: (query) => transact(['guest-heads', 'guest-objects'], 'readonly', (tx) => feed(tx, account, query)),
    batch: (timeline, writes) => transact(['guest-heads', 'guest-objects'], 'readwrite', (tx) => batch(tx, account, timeline, writes)),
    missingFiles: (ids, signal) => transact(['guest-files'], 'readwrite', async (tx) => {
      const files = tx.objectStore('guest-files');
      const held = await Promise.all(ids.map((id) => got<HeldFile | undefined>(files.get(objectKey(id)))));
      const now = Date.now();
      // Asked about is claimed, as the server's ask is: the sweep keeps it while the import writes what names it.
      held.forEach((file, index) => file && files.put({ ...file, claimed: now }, objectKey(ids[index]!)));
      return { ok: true, data: { missing: ids.filter((_, index) => !held[index]), maxBytes: MAX_FILE_BYTES, room: null } };
    }, signal),
    putFile: (id, body, signal) => transact(['guest-files'], 'readwrite', async (tx) => {
      if (body.length > MAX_FILE_BYTES) return failure('too-large');
      tx.objectStore('guest-files').put({ body, claimed: Date.now() } satisfies HeldFile, objectKey(id));
      return { ok: true, data: null };
    }, signal),
    readFile: (id, signal) => transact(['guest-files'], 'readonly', async (tx) => {
      const file = await got<HeldFile | undefined>(tx.objectStore('guest-files').get(objectKey(id)));
      return file ? { ok: true, data: file.body } : failure('not-found');
    }, signal),
    heldFiles: (after, signal) => transact(['guest-heads', 'guest-files'], 'readonly', async (tx) => {
      const head = await headOf(tx, account);
      if (!head) return failure('browser-storage');
      const range = IDBKeyRange.bound(after === null ? [account] : [account, after], [account, []], after !== null);
      const keys = await got<IDBValidKey[]>(tx.objectStore('guest-files').getAllKeys(range, MAX_FILE_IDS + 1));
      return { ok: true, data: { ids: keys.slice(0, MAX_FILE_IDS).map((key) => (key as [string, string])[1]), more: keys.length > MAX_FILE_IDS, rev: head.rev, timeline: head.timeline } };
    }, signal),
    // Nothing is ever taken back: a file no longer here has no other copy to come from.
    sweepFiles: ({ timeline, rev, unused }, signal) => transact(['guest-heads', 'guest-files'], 'readwrite', async (tx) => {
      const head = await headOf(tx, account);
      if (!head) return failure('browser-storage');
      if (head.timeline !== timeline) return RESET;
      if (head.rev !== rev) return failure('conflict');
      const files = tx.objectStore('guest-files');
      const settled = Date.now() - CLAIM_SETTLE_MS;
      const held = await Promise.all(unused.map((id) => got<HeldFile | undefined>(files.get(objectKey(id)))));
      let released = 0;
      held.forEach((file, index) => {
        if (!file || file.claimed > settled) return;
        files.delete(objectKey(unused[index]!));
        released++;
      });
      return { ok: true, data: { released, taken: 0 } };
    }, signal),
  };
}

async function feed(tx: IDBTransaction, account: string, query: FeedQuery): Promise<ApiResult<FeedAnswer>> {
  const head = await headOf(tx, account);
  if (!head) return failure('browser-storage');
  if (query.timeline === null ? query.since !== 0 || query.known !== 0 : query.timeline !== head.timeline) return RESET;
  const until = query.bootstrap ? (query.until ?? head.rev) : null;
  if (Math.max(query.since, query.known, until ?? 0) > head.rev) return RESET;
  const excluded = new Set(query.excluded);
  const objects = tx.objectStore('guest-objects');
  // A bootstrap leaves the excluded kinds out altogether, which for the store's own feed are exactly the unfed ones.
  const fedOnly = until !== null && query.parent === null && excluded.size === UNFED.size && [...UNFED].every((kind) => excluded.has(kind));
  const [index, low, high] = query.parent !== null
    ? ['parent', [account, query.parent, query.since], [account, query.parent, Infinity]]
    : query.kind !== null ? ['kind', [account, query.kind, query.since], [account, query.kind, until ?? Infinity]]
    : fedOnly ? ['scope', [account, '', query.since], [account, '', until]] : ['rev', [account, query.since], [account, until ?? Infinity]];
  const pageRows = query.metadata ? METADATA_PAGE_ROWS : PAGE_ROWS;
  const changes: SealedChange[] = [];
  let bytes = 0;
  let more = false;
  // An empty window: IndexedDB refuses a range whose ends meet with one of them open.
  const range = until !== null && until <= query.since ? null : IDBKeyRange.bound(low, high, true, false);
  if (range) await walk(objects.index(index).openCursor(range), (row: Row) => {
    if (query.kind !== null && row.kind !== query.kind) return true;
    if (until !== null && (excluded.has(row.kind) || row.rev > until)) return true;
    // The first row always fits; after it, a page stops at its row count or its body budget.
    if (changes.length === pageRows || bytes >= PAGE_BODY_BYTES) {
      more = true;
      return false;
    }
    const omitted = (excluded.has(row.kind) || query.metadata) && row.body !== null;
    if (!omitted) bytes += row.body?.length ?? 0;
    changes.push({ id: row.id, kind: row.kind, parent: row.parent, rev: row.rev, ...(omitted ? { omitted: true } : { body: row.body }) });
    return true;
  });
  // The bar's count, which only the store's own bootstrap asks for.
  const total = query.count && fedOnly ? (range ? await got<number>(objects.index('scope').count(range)) : 0) : undefined;
  return {
    ok: true,
    data: { limits: BATCH_LIMITS, timeline: head.timeline, ...(until === null ? {} : { until }), changes, cursor: changes.at(-1)?.rev ?? query.since, more, ...(total === undefined ? {} : { total }) },
  };
}

// The rules of server/account-store.ts batch: every fresh write takes the next rev in the order given, all or none.
async function batch(tx: IDBTransaction, account: string, timeline: string, writes: SealedWrite[]): Promise<ApiResult<BatchAnswer>> {
  const head = await headOf(tx, account);
  if (!head) return failure('browser-storage');
  if (head.timeline !== timeline) return RESET;
  const objects = tx.objectStore('guest-objects');
  const found = await Promise.all(writes.map(({ id }) => got<Row | undefined>(objects.get([account, id]))));
  const landed = new Map<string, number>();
  writes.forEach(({ id, kind, parent, once }, index) => {
    const row = found[index];
    if (once && row && row.kind === kind && row.parent === parent && row.body !== null) landed.set(id, row.rev);
  });
  const fresh = writes.flatMap((write, index) => (landed.has(write.id) ? [] : [{ write, row: found[index] }]));
  if (fresh.some(({ write, row }) => write.baseRev !== null && row && row.parent !== write.parent)) return failure('bad-input');
  const conflict = ({ write, row }: (typeof fresh)[number]) => write.baseRev === null ? row !== undefined : !row || row.kind !== write.kind || row.rev !== write.baseRev || (write.body === null && row.body === null);
  if (fresh.some(conflict)) return failure('conflict');
  const written = new Map<string, number>();
  fresh.forEach(({ write: { id, kind, parent, body } }, index) => {
    const rev = head.rev + index + 1;
    written.set(id, rev);
    objects.put({ account, id, kind, parent, rev, body, scope: UNFED.has(kind) ? parent! : '' } satisfies Row, [account, id]);
  });
  tx.objectStore('guest-heads').put({ ...head, rev: head.rev + fresh.length } satisfies Head, account);
  return { ok: true, data: { revs: writes.map(({ id }) => landed.get(id) ?? written.get(id)!), timeline } };
}

const headOf = (tx: IDBTransaction, account: string) => got<Head | undefined>(tx.objectStore('guest-heads').get(account));

// One transaction per call. A full browser answers browser-full; any other storage failure, or a store gone from under
// the page, browser-storage.
async function transact<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<ApiResult<T>>, signal?: AbortSignal): Promise<ApiResult<T>> {
  let stop: (() => void) | undefined;
  try {
    if (signal?.aborted) return failure('stopped');
    const db = await database();
    if (signal?.aborted) return failure('stopped');
    const tx = db.transaction(stores, mode);
    stop = () => tx.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
    // Awaited below; a work that failed first would leave its rejection unheard.
    done.catch(() => {});
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    if (signal?.aborted) return failure('stopped');
    if (!(error instanceof DOMException)) throw error;
    return failure(error.name === 'QuotaExceededError' ? 'browser-full' : 'browser-storage');
  } finally {
    if (stop) signal?.removeEventListener('abort', stop);
  }
}

function got<T>(request: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

// Each row in key order until visit answers false.
function walk(request: IDBRequest<IDBCursorWithValue | null>, visit: (row: Row) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && visit(cursor.value as Row)) cursor.continue();
      else resolve();
    };
  });
}
