import { cachedDatabase } from '../vault/database';
import type { SealedChange } from '../contracts/objects';
import { lockVault } from '../vault/device';
import { adoptable, cacheNewer, cacheScope, GenerationChanged, sameGeneration, type CachedScope, type CacheWrite, type DeviceCache, type Generation } from './object-cache';

const caches = new Map<string, BrowserCache>();
const draftCaches = new Map<string, BrowserDraftCache>();
const STORES = ['generations', 'states', 'objects'];

export function deviceCache(account: string): DeviceCache {
  let cache = caches.get(account);
  if (!cache) caches.set(account, (cache = new BrowserCache(account)));
  return cache;
}

export async function forgetVault(account: string, cache = deviceCache(account)): Promise<void> {
  if (cache instanceof BrowserCache) cache.forgotten = true;
  caches.delete(account);
  const drafts = draftCache(account);
  drafts.forgotten = true;
  draftCaches.delete(account);
  await Promise.all([lockVault(), cache.forget().catch(() => {}), drafts.forget().catch(() => {})]);
}

export function draftCache(account: string): BrowserDraftCache {
  let cache = draftCaches.get(account);
  if (!cache) draftCaches.set(account, (cache = new BrowserDraftCache(account)));
  return cache;
}

class BrowserDraftCache {
  forgotten = false;
  constructor(private readonly account: string) {}

  async read(): Promise<[string, string][]> {
    const tx = (await database()).transaction('drafts');
    const done = completed(tx);
    const store = tx.objectStore('drafts');
    const range = IDBKeyRange.bound([this.account], [this.account, []]);
    const keys = store.getAllKeys(range);
    const values = store.getAll(range);
    await done;
    return keys.result.map((key, index) => [(key as string[])[1]!, values.result[index] as string]);
  }

  async write(rows: readonly (readonly [string, string | null])[]): Promise<void> {
    const db = await database();
    // Encryption can finish after logout; never let that work recreate forgotten drafts.
    if (this.forgotten) throw new Error('This account was logged out');
    const tx = db.transaction('drafts', 'readwrite');
    const done = completed(tx);
    const store = tx.objectStore('drafts');
    for (const [key, body] of rows) {
      if (body === null) store.delete([this.account, key]);
      else store.put(body, [this.account, key]);
    }
    await done;
  }

  async forget(): Promise<void> {
    const tx = (await database()).transaction('drafts', 'readwrite');
    const done = completed(tx);
    tx.objectStore('drafts').delete(IDBKeyRange.bound([this.account], [this.account, []]));
    await done;
  }
}

// Whether any account was opened in this browser and not logged out of: its cache stays until 로그아웃 forgets it.
export async function cachedAccounts(): Promise<boolean> {
  const tx = (await database()).transaction('generations');
  const counted = tx.objectStore('generations').count();
  return new Promise((resolve, reject) => {
    counted.onsuccess = () => resolve(counted.result > 0);
    counted.onerror = () => reject(counted.error);
  });
}

class BrowserCache implements DeviceCache {
  forgotten = false;
  constructor(private readonly account: string) {}

  async open(): Promise<{ generation: Generation; saved: CachedScope | null }> {
    const { tx, done } = await this.transaction();
    let generation!: Generation;
    let saved: CachedScope | null = null;
    const get = tx.objectStore('generations').get(this.account);
    get.onsuccess = () => {
      const stored = get.result as Generation | undefined;
      if (!stored) {
        generation = { id: crypto.randomUUID(), timeline: null };
        this.wipe(tx);
        tx.objectStore('generations').put(generation, this.account);
        return;
      }
      generation = stored;
      if (stored.timeline === null) return;
      this.scope(tx, '', (scope) => { saved = scope; });
    };
    await done;
    return { generation, saved };
  }

  async read(generation: Generation, chat: string): Promise<CachedScope | null> {
    const { tx, done } = await this.transaction();
    let saved: CachedScope | null = null;
    this.compare(tx, (stored) => sameGeneration(stored, generation), () => this.scope(tx, chat, (scope) => { saved = scope; }));
    await done;
    return saved;
  }

  async write(generation: Generation, { changes, feed, scopes }: CacheWrite): Promise<void> {
    const { tx, done } = await this.transaction();
    this.compare(tx, (stored) => sameGeneration(stored, generation), () => {
      const objects = tx.objectStore('objects');
      for (const row of changes) {
        const key = [this.account, row.id];
        const get = objects.get(key);
        get.onsuccess = () => {
          if (cacheNewer(get.result as SealedChange | undefined, row)) objects.put({ ...row, account: this.account, scope: cacheScope(row) }, key);
        };
      }
      tx.objectStore('states').put(feed, [this.account, '']);
      for (const scope of scopes ?? []) tx.objectStore('states').put(scope.state, [this.account, scope.chat]);
    });
    await done;
  }

  async clear(generation: Generation): Promise<Generation> {
    const { tx, done } = await this.transaction();
    const next = { id: crypto.randomUUID(), timeline: null };
    this.compare(tx, (stored) => stored?.id === generation.id, () => {
      this.wipe(tx);
      tx.objectStore('generations').put(next, this.account);
    });
    await done;
    return next;
  }

  async adopt(generation: Generation, timeline: string): Promise<Generation> {
    const { tx, done } = await this.transaction();
    const next = { id: generation.id, timeline };
    this.compare(tx, (stored) => adoptable(stored, generation, timeline), () => tx.objectStore('generations').put(next, this.account));
    await done;
    return next;
  }

  async forget(): Promise<void> {
    const db = await database();
    const tx = db.transaction(STORES, 'readwrite');
    const done = completed(tx);
    this.wipe(tx);
    tx.objectStore('generations').delete(this.account);
    await done;
  }

  // A logged-out tab's late cache work fails, as a broken cache does, and the tab stops caching.
  private async transaction() {
    const db = await database();
    if (this.forgotten) throw new Error('This account was logged out');
    const tx = db.transaction(STORES, 'readwrite');
    return { tx, done: completed(tx) };
  }

  // The generation is read and compared inside the transaction that acts on it; a mismatch aborts it whole.
  private compare(tx: IDBTransaction, matches: (stored: Generation | undefined) => boolean, act: () => void) {
    const get = tx.objectStore('generations').get(this.account);
    get.onsuccess = () => {
      if (matches(get.result as Generation | undefined)) return act();
      changed.add(tx);
      tx.abort();
    };
  }

  private scope(tx: IDBTransaction, chat: string, found: (scope: CachedScope) => void) {
    const state = tx.objectStore('states').get([this.account, chat]);
    const rows = tx.objectStore('objects').index('scope').getAll([this.account, chat]);
    rows.onsuccess = () => {
      if (state.result) found({ state: state.result as CachedScope['state'], changes: rows.result as SealedChange[] });
    };
  }

  private wipe(tx: IDBTransaction) {
    const range = IDBKeyRange.bound([this.account], [this.account, []]);
    tx.objectStore('states').delete(range);
    tx.objectStore('objects').delete(range);
  }
}

// Transactions aborted because the stated generation was not the stored one.
const changed = new WeakSet<IDBTransaction>();

// Also a guest's own store (runtime/guest-store), the account's master rather than a copy of the server's.
// An account's page goes on without a blocked cache; the guest store cannot, so it surfaces the block.
export const database = cachedDatabase('risu-alpha-objects', 4, (req, event) => {
  const db = req.result;
  if (event.oldVersion === 0) {
    db.createObjectStore('generations');
    db.createObjectStore('states');
    db.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
  }
  if (event.oldVersion < 3) {
    db.createObjectStore('guest-heads');
    const objects = db.createObjectStore('guest-objects');
    objects.createIndex('rev', ['account', 'rev']);
    objects.createIndex('parent', ['account', 'parent', 'rev']);
    objects.createIndex('scope', ['account', 'scope', 'rev']);
    objects.createIndex('kind', ['account', 'kind', 'rev']);
    db.createObjectStore('guest-files');
  }
  if (event.oldVersion < 4) db.createObjectStore('drafts');
});

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(changed.has(tx) ? new GenerationChanged() : tx.error);
  });
}
