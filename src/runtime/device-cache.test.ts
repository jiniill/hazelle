import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => vi.unstubAllGlobals());

const done = (request: IDBRequest | IDBTransaction) => new Promise((resolve, reject) => {
  if (request instanceof IDBTransaction) request.oncomplete = resolve;
  else request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

it('keeps a version-2 cache’s rows when it adds the guest stores', async () => {
  const { database } = await import('./device-cache');
  const old = indexedDB.open('risu-alpha-objects', 2);
  old.onupgradeneeded = () => {
    old.result.createObjectStore('generations');
    old.result.createObjectStore('states');
    old.result.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
  };
  const v2 = (await done(old)) as IDBDatabase;
  const tx = v2.transaction('objects', 'readwrite');
  tx.objectStore('objects').put({ id: 'kept', scope: '' }, ['account', 'kept']);
  await done(tx);
  v2.close();
  const db = await database();
  expect([...db.objectStoreNames].sort()).toEqual(['drafts', 'generations', 'guest-files', 'guest-heads', 'guest-objects', 'objects', 'states']);
  expect(await done(db.transaction('objects').objectStore('objects').get(['account', 'kept']))).toEqual({ id: 'kept', scope: '' });
});

it('retries a blocked cache upgrade without keeping its rejected promise or late connection', async () => {
  const old = indexedDB.open('risu-alpha-objects', 2);
  old.onupgradeneeded = () => {
    old.result.createObjectStore('generations');
    old.result.createObjectStore('states');
    old.result.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
  };
  const v2 = (await done(old)) as IDBDatabase;
  const { database } = await import('./device-cache');
  const { DatabaseBlocked } = await import('../vault/database');
  try {
    await expect(database()).rejects.toBeInstanceOf(DatabaseBlocked);
  } finally {
    v2.close();
  }
  const db = await database();
  expect(db.version).toBe(4);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase('risu-alpha-objects');
    req.onsuccess = () => resolve();
    req.onblocked = () => reject(new Error('A late or current connection stayed open'));
    req.onerror = () => reject(req.error);
  });
  expect((await database()).version).toBe(4);
});

it('adds only drafts to a version-3 database, retaining account and guest data', async () => {
  const old = indexedDB.open('risu-alpha-objects', 3);
  old.onupgradeneeded = () => {
    const db = old.result;
    db.createObjectStore('generations');
    db.createObjectStore('states');
    db.createObjectStore('objects').createIndex('scope', ['account', 'scope']);
    db.createObjectStore('guest-heads');
    const objects = db.createObjectStore('guest-objects');
    objects.createIndex('rev', ['account', 'rev']);
    objects.createIndex('parent', ['account', 'parent', 'rev']);
    objects.createIndex('scope', ['account', 'scope', 'rev']);
    objects.createIndex('kind', ['account', 'kind', 'rev']);
    db.createObjectStore('guest-files');
  };
  const v3 = await done(old) as IDBDatabase;
  const stores = [...v3.objectStoreNames];
  const tx = v3.transaction(stores, 'readwrite');
  for (const store of stores) tx.objectStore(store).put({ kept: store }, ['account', 'kept']);
  await done(tx);
  v3.close();

  const { database } = await import('./device-cache');
  const db = await database();
  expect(db.version).toBe(4);
  expect([...db.objectStoreNames]).toEqual(['drafts', ...stores]);
  for (const store of stores) {
    expect(await done(db.transaction(store).objectStore(store).get(['account', 'kept']))).toEqual({ kept: store });
  }
  expect([...db.transaction('guest-objects').objectStore('guest-objects').indexNames]).toEqual(['kind', 'parent', 'rev', 'scope']);
});

it('forgets only the account’s drafts and rejects its late writes', async () => {
  const { draftCache, forgetVault } = await import('./device-cache');
  const account = draftCache('account');
  const other = draftCache('other');
  await account.write([['chat', 'sealed']]);
  await other.write([['chat', 'other sealed']]);
  await forgetVault('account');
  await expect(account.write([['chat', 'late sealed']])).rejects.toThrow('This account was logged out');
  expect(await draftCache('account').read()).toEqual([]);
  expect(await other.read()).toEqual([['chat', 'other sealed']]);
});
