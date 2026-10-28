import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_SETTLE_MS } from '../contracts/files';
import type { Connection } from '../connectors/types';
import { SETTINGS_ID } from '../model/settings';
import { randomBytes } from '../vault/aead';
import { feedQuery } from './backend';
import { guestAccount, guestBackend, guestBoardSecret } from './guest-store';
import { Files } from './files';
import { openSession } from './session';
import { ObjectStore, type PullProgress } from './store';

const connection = (label: string): Connection => ({ type: 'openrouter', label, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-x' }], turns: null, starred: [] });

const stores: ObjectStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// A browser holds one guest, so every test here shares it and counts what it adds. Each open() is one more tab of
// it, as server.account()'s is one more device.
async function guest() {
  const { accountId, vaultKey } = await guestAccount();
  const backend = guestBackend(accountId);
  const open = async () => {
    const store = await ObjectStore.open(accountId, vaultKey, backend);
    stores.push(store);
    await store.pull();
    return store;
  };
  return { accountId, vaultKey, backend, open };
}

describe('a guest’s browser store', () => {
  it('serializes two first visits into one guest and finds it again on later pages', async () => {
    const [first, second] = await Promise.all([guestAccount(), guestAccount()]);
    expect(second).toEqual(first);
    expect(await guestAccount()).toEqual(first);
  });

  it('shares writes between tabs and reapplies a change after a conflict', async () => {
    const { open } = await guest();
    const [one, two] = [await open(), await open()];
    const created = await one.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    await two.pull();
    expect(two.get('connection', created.data.id)?.value.label).toBe('a');
    await one.update('connection', created.data.id, (current) => ({ ...current, label: `${current.label}b` }));
    const saved = await two.update('connection', created.data.id, (current) => ({ ...current, label: `${current.label}c` }));
    expect(saved.ok && saved.data.value.label).toBe('abc');
    expect(await two.update('connection', crypto.randomUUID(), (current) => current)).toEqual({ ok: false, error: 'gone' });
  });

  it('reads a chat’s messages only while it is held, through removals and restores in another tab', async () => {
    const { open } = await guest();
    const [one, two] = [await open(), await open()];
    const chat = crypto.randomUUID();
    const writing = one.retainChat(chat, { created: true });
    expect(await writing.ready).toBeNull();
    const first = await one.create('entry', { type: 'delete', message: 'first', at: 0 }, { parent: chat });
    const second = await one.create('entry', { type: 'delete', message: 'second', at: 1 }, { parent: chat });
    if (!first.ok || !second.ok) throw new Error('create failed');
    await two.pull();
    expect(() => two.list('entry')).toThrow('not loaded');
    const lease = two.retainChat(chat);
    expect(await lease.ready).toBeNull();
    expect(two.children('entry', chat)).toEqual([first.data, second.data]);
    expect((await one.remove(first.data.id)).ok).toBe(true);
    await two.pull();
    expect(two.children('entry', chat).map(({ id }) => id)).toEqual([second.data.id]);
    expect((await two.restore(first.data)).ok).toBe(true);
    await one.pull();
    expect(two.children('entry', chat).map(({ id }) => id)).toEqual([second.data.id, first.data.id]);
    lease.release();
    writing.release();
  });

  it('bootstraps a tab in pages and tells it how much the whole bootstrap holds', async () => {
    const { open, accountId, vaultKey, backend } = await guest();
    const writer = await open();
    const before = writer.list('connection').length;
    expect(await writer.batch(Array.from({ length: 600 }, (_, index) => ({ type: 'create' as const, kind: 'connection' as const, id: crypto.randomUUID(), parent: null, value: connection(`c${index}`) })))).toEqual({ ok: true, data: null });
    const reader = await ObjectStore.open(accountId, vaultKey, backend);
    stores.push(reader);
    const seen: PullProgress[] = [];
    await reader.pull({ progress: (progress) => seen.push(progress) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0]!.total).toBe(seen.at(-1)!.objects);
    expect(reader.list('connection')).toHaveLength(before + 600);
    expect(await writer.batch([{ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent: crypto.randomUUID(), value: { type: 'delete', message: 'm', at: 0 } }], undefined, { unheld: true })).toEqual({ ok: true, data: null });
    const kindOnly = await backend.feed(feedQuery({ since: 0, timeline: null, kind: 'entry' }));
    expect(kindOnly.ok && kindOnly.data.changes.length && kindOnly.data.changes.every(({ kind }) => kind === 'entry')).toBe(true);
  });

  it('keeps pictures in the browser and releases one no object names only after its claim settles', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { open, backend } = await guest();
    const store = await open();
    const files = new Files(backend, store);
    const image = randomBytes(256);
    const saved = await files.save([image]);
    if (!saved.ok) throw new Error(saved.error);
    expect(await files.read(saved.data[0]!)).toEqual({ ok: true, data: image });
    expect(await files.release()).toEqual({ ok: true, data: { released: 0, taken: 0 } });
    vi.setSystemTime(Date.now() + CLAIM_SETTLE_MS + 1);
    expect(await files.release()).toEqual({ ok: true, data: { released: 1, taken: 0 } });
    expect(await files.read(saved.data[0]!)).toEqual({ ok: false, error: 'not-found' });
  });

  it('opens a session with its defaults and sends nothing to the server', async () => {
    const fetched = vi.fn(() => Promise.reject(new Error('no network for a guest')));
    vi.stubGlobal('fetch', fetched);
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const { accountId, vaultKey, backend } = await guest();
    const opened = await openSession(accountId, vaultKey, '손님', new AbortController().signal, undefined, { backend });
    if (!opened.ok) throw new Error(opened.error);
    expect(opened.data.store.get('settings', SETTINGS_ID)?.value.persona).toBeDefined();
    opened.data.close();
    expect(fetched).not.toHaveBeenCalled();
  });
});

it('keeps one board secret across tabs beside the guest head and out of the object and file feeds', async () => {
  const { accountId, backend } = await guest();
  const [one, two] = await Promise.all([guestBoardSecret(accountId, true), guestBoardSecret(accountId, true)]);
  expect(one).toEqual(two);
  expect(one).toEqual({ ok: true, data: expect.stringMatching(/^[0-9a-f]{64}$/) });
  expect(await guestBoardSecret(accountId)).toEqual(one);
  expect(JSON.stringify(await backend.feed(feedQuery({ since: 0, timeline: null })))).not.toContain(one.ok ? one.data! : '');
  expect(JSON.stringify(await backend.heldFiles(null))).not.toContain(one.ok ? one.data! : '');
});

it('aborts a guest file write in its transaction and reports stopped without storing it', async () => {
  const { backend } = await guest();
  const stop = new AbortController();
  const id = 'a'.repeat(64);
  const put = IDBObjectStore.prototype.put;
  const write = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: IDBObjectStore, ...args) {
    const request = put.apply(this, args);
    queueMicrotask(() => stop.abort());
    return request;
  });
  try {
    expect(await backend.putFile(id, randomBytes(32), stop.signal)).toEqual({ ok: false, error: 'stopped' });
    expect(await backend.readFile(id)).toEqual({ ok: false, error: 'not-found' });
  } finally {
    write.mockRestore();
  }
});
