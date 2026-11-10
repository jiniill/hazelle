import type { Kind, Stored } from '../../model/kinds';
import { openObject, sealObject } from '../../vault/objects';
import { ownershipDepth } from '../library/removal';

export const BACKUP_PAGE_BYTES = 1024 * 1024;
export const BACKUP_PAGE_ROWS = 128;
export type BackupRecord = { object: Stored<Kind>; size: number };
export interface BackupRecords {
  write(records: BackupRecord[], signal: AbortSignal): Promise<void>;
  read(depth: number, wanted: ReadonlySet<string>, signal: AbortSignal): AsyncIterable<BackupRecord>;
  close(): Promise<void>;
}
export class BackupStorageError extends Error {}

type Cell = { ordinal: number; depth: number; ids: string[]; body: string; size: number };
const PREFIX = 'risu-alpha-backup-stage-';
const pageAddress = (ordinal: number, depth: number) => ({ id: String(ordinal), kind: 'backup-page', parent: String(depth) });

const failed = (error: unknown) => new BackupStorageError(String(error));
const transactionDone = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = tx.onabort = () => reject(failed(tx.error));
});
const removeDatabase = (name: string) => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(name);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(failed(request.error));
  request.onblocked = () => reject(new BackupStorageError('Temporary backup database is still open'));
});

// Only the worker holds this stage's key. A crashed worker can leave encrypted temporary rows, never a readable
// account backup; its Web Lock disappears on termination, so a later worker can reclaim that abandoned database.
export async function createBackupRecords(): Promise<BackupRecords> {
  try { return await openRecords(); } catch (error) { throw failed(error); }
}

async function openRecords(): Promise<BackupRecords> {
  if (!globalThis.indexedDB || !navigator.locks) throw new BackupStorageError('Temporary backup storage is unavailable');
  for (const { name } of await indexedDB.databases()) {
    if (!name?.startsWith(PREFIX)) continue;
    await navigator.locks.request(name, { ifAvailable: true }, async (lock) => { if (lock) await removeDatabase(name); });
  }
  const name = PREFIX + crypto.randomUUID();
  let release!: () => void;
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => { acquired = resolve; });
  const lifetime = navigator.locks.request(name, async () => {
    const done = new Promise<void>((resolve) => { release = resolve; });
    acquired();
    await done;
  });
  await Promise.race([ready, lifetime]);
  try {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('records');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(failed(request.error));
    });
    return new DiskRecords(name, db, key, async () => { release(); await lifetime; });
  } catch (error) {
    release();
    await lifetime;
    throw failed(error);
  }
}

export function byDepth(records: BackupRecord[]): Map<number, BackupRecord[]> {
  const depths = new Map<number, BackupRecord[]>();
  for (const record of records) {
    const depth = ownershipDepth(record.object.kind);
    let page = depths.get(depth);
    if (!page) depths.set(depth, (page = []));
    page.push(record);
  }
  return depths;
}

class DiskRecords implements BackupRecords {
  private next = 0;
  constructor(private readonly name: string, private readonly db: IDBDatabase, private readonly key: CryptoKey, private readonly release: () => Promise<void>) {}

  async write(records: BackupRecord[], signal: AbortSignal) {
    const depths = byDepth(records);
    const cells: Cell[] = [];
    // Seal bounded pages, not one crypto job per tiny message. The page ordinal preserves equal-revision source
    // order within its depth; the existing vault codec remains the only temporary JSON/compression format owner.
    for (const [depth, page] of depths) {
      signal.throwIfAborted();
      const ordinal = this.next++;
      cells.push({ ordinal, depth, ids: page.map(({ object }) => object.id), size: page.reduce((sum, record) => sum + record.size, 0), body: await sealObject(this.key, this.name, pageAddress(ordinal, depth), page) });
    }
    signal.throwIfAborted();
    const tx = this.db.transaction('records', 'readwrite');
    const done = transactionDone(tx);
    for (const cell of cells) tx.objectStore('records').put(cell, [cell.depth, cell.ordinal]);
    await done;
  }

  async *read(depth: number, wanted: ReadonlySet<string>, signal: AbortSignal): AsyncIterable<BackupRecord> {
    let after: IDBValidKey | null = null;
    for (;;) {
      signal.throwIfAborted();
      const page = await this.page(depth, after);
      for (const cell of page.cells) {
        signal.throwIfAborted();
        if (!cell.ids.some((id) => wanted.has(id))) continue;
        const records = await openObject(this.key, this.name, pageAddress(cell.ordinal, depth), cell.body) as BackupRecord[] | undefined;
        if (records === undefined) throw new BackupStorageError('Temporary backup page did not open');
        for (const record of records) {
          signal.throwIfAborted();
          if (wanted.has(record.object.id)) yield record;
        }
      }
      if (page.done) return;
      after = page.after;
    }
  }

  private page(depth: number, after: IDBValidKey | null): Promise<{ cells: Cell[]; after: IDBValidKey | null; done: boolean }> {
    const tx = this.db.transaction('records', 'readonly');
    const range = after === null ? IDBKeyRange.bound([depth], [depth, []]) : IDBKeyRange.bound(after, [depth, []], true);
    const request = tx.objectStore('records').openCursor(range);
    const cells: Cell[] = [];
    let bytes = 0;
    let last = after;
    let ended = false;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { ended = true; return; }
      const cell = cursor.value as Cell;
      if (cells.length && (cells.length === BACKUP_PAGE_ROWS || bytes + cell.size > BACKUP_PAGE_BYTES)) return;
      cells.push(cell);
      bytes += cell.size;
      last = cursor.key;
      cursor.continue();
    };
    return transactionDone(tx).then(() => ({ cells, after: last, done: ended }));
  }

  async close() {
    this.db.close();
    try { await removeDatabase(this.name); }
    finally { await this.release(); }
  }
}
