import { describe, expect, it, vi } from 'vitest';
import { serverBackend } from './backend';
import type { Connection } from '../connectors/types';
import type { Lore } from '../model/library';
import { emptyMemory } from '../model/memory';
import { randomBytes, toBase64 } from '../vault/aead';
import { api } from './api';
import { EvaluationFailed } from './evaluation';
import { ObjectStore, type PullProgress } from './store';
import type { Write } from './object-writes';
import { ScopeUnavailable, type ChatLease } from './chat-scope';
import { summaryId, summaryStale } from './summary';
import { BATCH_LIMITS } from '../contracts/objects';
import { testServer } from './testing';

const server = testServer();

const connection = (label: string): Connection => ({ type: 'openrouter', label, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-x' }], turns: null, starred: [] });
const renamed = (suffix: string) => (current: Connection) => ({ ...current, label: current.label + suffix });
const message = (parent: string, at: number): Write => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent, value: { type: 'message', role: 'user', at, text: `m${at}`, receipt: null } });
const root = (id: string): Write => ({ type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {} } });

describe('object store', () => {
  it('tells a bootstrap how much it holds with its first page, and an incremental pull nothing', async () => {
    const { store: laptop, open } = await server.account();
    await laptop.create('connection', connection('a'));
    await laptop.create('connection', connection('b'));
    const phone = await open();
    const seen: PullProgress[] = [];
    await phone.pull({ progress: (progress) => seen.push(progress) });
    expect(seen[0]).toMatchObject({ pages: 1, total: seen.at(-1)!.objects });
    expect(seen.at(-1)!.objects).toBeGreaterThanOrEqual(2);
    await laptop.create('connection', connection('c'));
    const later: PullProgress[] = [];
    await phone.pull({ progress: (progress) => later.push(progress) });
    expect(later.at(-1)).toMatchObject({ objects: 1 });
    expect(later.at(-1)).not.toHaveProperty('total');
  });

  it('shares writes between devices and reapplies a change after a conflict', async () => {
    const { store: laptop, open } = await server.account();
    const phone = await open();

    const created = await laptop.create('connection', connection('a'));
    const id = created.ok ? created.data.id : '';
    await phone.pull();
    expect(phone.get('connection', id)?.value.label).toBe('a');

    await laptop.update('connection', id, renamed('b'));
    const saved = await phone.update('connection', id, renamed('c'));
    expect(saved.ok && saved.data.value.label).toBe('abc');
    await laptop.pull();
    expect(laptop.get('connection', id)?.value.label).toBe('abc');
  });

  it('never brings back what another device removed, except by restoring it', async () => {
    const { store: laptop, open } = await server.account();
    const phone = await open();
    const created = await laptop.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const { id } = created.data;
    await phone.pull();

    expect(await laptop.remove(id)).toEqual({ ok: true, data: null });
    expect(await phone.update('connection', id, renamed('b'))).toEqual({ ok: false, error: 'gone' });
    expect(phone.list('connection')).toEqual([]);

    expect((await phone.restore(created.data)).ok).toBe(true);
    await laptop.pull();
    expect(laptop.get('connection', id)?.value.label).toBe('a');
  });

  it("keeps each object's parent and finds children by it", async () => {
    const { store } = await server.account();
    const chat = await store.create('chat', { title: null, character: null, models: {} });
    if (!chat.ok) throw new Error(chat.error);
    await server.hold(store, chat.data.id);
    const entry = { type: 'delete', message: 'm', at: 0 } as const;
    const first = await store.create('entry', entry, { parent: chat.data.id });
    expect(first.ok && first.data.parent).toBe(chat.data.id);
    expect(await store.create('entry', entry)).toEqual({ ok: false, error: 'bad-input' });
    const lore: Lore = { name: 'x', keys: [], secondaryKeys: [], content: '', enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 100, priority: null, position: null, folder: null };
    expect((await store.create('lore', lore, { parent: chat.data.id })).ok).toBe(true);
    expect(await store.create('share', { share: 's', key: 'k' }, { parent: chat.data.id })).toEqual({ ok: false, error: 'bad-input' });
    expect(store.children('entry', chat.data.id).map((child) => child.value)).toEqual([entry]);
  });

  it('summarizes chats a caller holds in one request from what it wrote, and an unheld batch summarizes nothing', async () => {
    const { store } = await server.account();
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const leases = ids.map((id) => store.retainChat(id, { created: true }));
    for (const lease of leases) expect(await lease.ready).toBeNull();
    const summarizing = vi.spyOn(store.projections, 'save');
    const entries: Write[] = ids.map((parent) => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent, value: { type: 'delete', message: 'm', at: 0 } }));
    expect(await store.batch(entries, undefined, { unheld: true })).toEqual({ ok: true, data: null });
    const roots: Write[] = ids.map((id) => ({ type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {} } }));
    expect(await store.batch(roots, undefined, { unheld: true })).toEqual({ ok: true, data: null });
    const fetched = vi.spyOn(globalThis, 'fetch');
    expect(await store.projections.saveMany(ids)).toBeNull();
    expect(summarizing).not.toHaveBeenCalled();
    expect(fetched.mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toEqual(['POST /api/objects/batch']);
    for (const id of ids) {
      const summary = store.get('summary', summaryId(id))!.value;
      expect(summaryStale(store, id, summary)).toBe(false);
    }
    for (const lease of leases) lease.release();
    expect(await store.projections.saveMany(ids.slice(0, 1)).catch((error: unknown) => error)).toBeInstanceOf(ScopeUnavailable);
  });

  it('answers a held chat whose evaluation failed with that failure instead of throwing', async () => {
    const { store } = await server.account();
    const id = crypto.randomUUID();
    const lease = store.retainChat(id, { created: true });
    expect(await lease.ready).toBeNull();
    vi.spyOn(store.evaluation, 'display').mockRejectedValue(new EvaluationFailed('down'));
    expect(await store.batch([{ type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {} } }], undefined, { unheld: true })).toEqual({ ok: true, data: null });
    await store.projections.evaluate(id).catch(() => null);
    expect(store.scopeState(id)).toBe('failed');
    expect(await store.projections.saveMany([id])).toEqual({ ok: false, error: 'evaluation-unavailable' });
    lease.release();
  });

  it('rewrites a summary its chat outgrew while the others were built', async () => {
    const { store } = await server.account();
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    const leases = [a, b].map((id) => store.retainChat(id, { created: true }));
    for (const lease of leases) expect(await lease.ready).toBeNull();
    expect(await store.batch([message(a, 1), message(b, 1)], undefined, { unheld: true })).toEqual({ ok: true, data: null });
    expect(await store.batch([root(a), root(b)], undefined, { unheld: true })).toEqual({ ok: true, data: null });
    await store.projections.evaluate(a);
    await store.projections.evaluate(b);
    const evaluated = store.projections.evaluate.bind(store.projections);
    let grown = false;
    // The second chat's turn comes once the first's summary is captured; a's growth goes unheld, so nothing but the
    // pass under test could summarize it again.
    vi.spyOn(store.projections, 'evaluate').mockImplementation(async (chat) => {
      if (chat === b && !grown) {
        grown = true;
        expect(await store.batch([message(a, 2)], undefined, { unheld: true })).toEqual({ ok: true, data: null });
      }
      return evaluated(chat);
    });
    expect(await store.projections.saveMany([a, b])).toBeNull();
    const summary = store.get('summary', summaryId(a))!.value;
    expect(summary.count).toBe(2);
    expect(summaryStale(store, a, summary)).toBe(false);
    for (const lease of leases) lease.release();
  });

  it('passes over a held chat whose catch-up cannot be read and summarizes the rest of the window', async () => {
    const { store, open } = await server.account();
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    const phone = await open();
    expect((await phone.batch([message(a, 1), message(b, 1), root(a), root(b)], undefined, { unheld: true })).ok).toBe(true);
    await store.pull();
    const leases = [a, b].map((id) => store.retainChat(id, { summarize: false }));
    for (const lease of leases) expect(await lease.ready).toBeNull();
    expect((await phone.batch([message(a, 2)], undefined, { unheld: true })).ok).toBe(true);
    vi.spyOn(store, 'refreshChat').mockResolvedValue({ ok: false, error: 'unreadable' });
    await store.pull();
    expect(await store.projections.saveMany([a, b])).toBeNull();
    expect(store.get('summary', summaryId(a))).toBeNull();
    expect(store.get('summary', summaryId(b))!.value.count).toBe(1);
    for (const lease of leases) lease.release();
  });

  it('summarizes a chat opened for a pass that wrote nothing once a later holder asks for its summary', async () => {
    const { store, open } = await server.account();
    const a = crypto.randomUUID();
    const phone = await open();
    expect((await phone.batch([message(a, 1), root(a)], undefined, { unheld: true })).ok).toBe(true);
    await store.pull();
    let screen: ChatLease | null = null;
    const pass = await store.withChats([a], async () => {
      screen = store.retainChat(a);
      return { ok: false, error: 'stopped' };
    }, { summarize: false });
    expect(pass).toEqual({ ok: false, error: 'stopped' });
    expect(await screen!.ready).toBeNull();
    await vi.waitFor(() => expect(store.get('summary', summaryId(a))?.value).toMatchObject({ count: 1 }));
    screen!.release();
  });

  it('answers stopped, not a thrown scope, when its caller lets the window go before the first write', async () => {
    const { store, open } = await server.account();
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()];
    const phone = await open();
    expect((await phone.batch([message(a, 1), message(b, 1), root(a), root(b)], undefined, { unheld: true })).ok).toBe(true);
    await store.pull();
    const stop = new AbortController();
    const evaluated = store.projections.evaluate.bind(store.projections);
    // Armed once both are open: the stop lands inside the pass, before its first write.
    const pass = await store.withChats([a, b], async (ids) => {
      vi.spyOn(store.projections, 'evaluate').mockImplementation(async (chat) => { stop.abort(); return evaluated(chat); });
      return await store.projections.saveMany(ids, stop.signal) ?? { ok: true, data: null };
    }, { signal: stop.signal, summarize: false });
    expect(pass).toEqual({ ok: false, error: 'stopped' });
    expect([a, b].map((id) => store.scopeState(id))).toEqual(['unloaded', 'unloaded']);
  });

  it('answers a create tried again after it landed with the object it made', async () => {
    const { store, open } = await server.account();
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const other = await open();
    expect(await other.create('connection', connection('a'), { id: created.data.id })).toMatchObject({ ok: true, data: { id: created.data.id } });
    expect(await other.create('connection', connection('b'), { id: created.data.id })).toEqual({ ok: false, error: 'conflict' });
  });

  it('keeps kind and parent reads in order through local and pulled replacements, removals and restores', async () => {
    const { store, open } = await server.account();
    const phone = await open();
    const parent = crypto.randomUUID();
    const otherParent = crypto.randomUUID();
    await server.hold(store, parent, otherParent);
    await server.hold(phone, parent, otherParent);
    const first = await store.create('entry', { type: 'delete', message: 'first', at: 0 }, { parent });
    const memory = await store.create('memory', emptyMemory(), { parent });
    const second = await store.create('entry', { type: 'delete', message: 'second', at: 1 }, { parent });
    const other = await store.create('entry', { type: 'delete', message: 'other', at: 2 }, { parent: otherParent });
    if (!first.ok || !memory.ok || !second.ok || !other.ok) throw new Error('create failed');
    await phone.pull();
    for (const device of [store, phone]) {
      expect(() => device.list('entry')).toThrow('not loaded');
      expect(device.children('entry', parent)).toEqual([first.data, second.data]);
      expect(device.children('memory', parent)).toEqual([memory.data]);
      expect(device.children('entry', otherParent)).toEqual([other.data]);
    }

    expect((await store.restore(first.data)).ok).toBe(true);
    expect((await store.remove(memory.data.id)).ok).toBe(true);
    expect((await store.remove(other.data.id)).ok).toBe(true);
    await phone.pull();
    for (const device of [store, phone]) {
      expect(device.children('entry', parent).map(({ id }) => id)).toEqual([second.data.id, first.data.id]);
      expect(device.children('memory', parent)).toEqual([]);
      expect(device.children('entry', otherParent)).toEqual([]);
    }

    const restored = await store.restore(other.data);
    if (!restored.ok) throw new Error(restored.error);
    await phone.pull();
    for (const device of [store, phone]) {
      expect(device.children('entry', otherParent)).toEqual([restored.data]);
      expect([...device.children('entry', parent), ...device.children('entry', otherParent)].map(({ id }) => id)).toEqual([second.data.id, first.data.id, other.data.id]);
    }
  });

  it('decrypts only pulled objects newer than the revisions already held', async () => {
    const { store, open } = await server.account();
    const local = await store.create('connection', connection('local'));
    if (!local.ok) throw new Error(local.error);
    const phone = await open();
    await phone.pull();
    const remote = await phone.create('connection', connection('remote'));
    if (!remote.ok) throw new Error(remote.error);

    const decrypt = vi.spyOn(crypto.subtle, 'decrypt');
    try {
      await store.pull();
      expect(decrypt).toHaveBeenCalledTimes(1);
      expect(store.list('connection')).toEqual([local.data, remote.data]);
    } finally {
      decrypt.mockRestore();
    }
  });

  it('keeps a write that lands while a pull is still opening an older copy', async () => {
    const { accountId, vaultKey } = await server.account();
    let meanwhile: (() => Promise<unknown>) | null = null;
    const request = async <T,>(...args: Parameters<typeof api>) => {
      const result = await api<T>(...args);
      const landing = meanwhile;
      meanwhile = null;
      await landing?.();
      return result;
    };
    const store = await ObjectStore.open(accountId, vaultKey, serverBackend(request));
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const { id } = created.data;

    meanwhile = () => store.update('connection', id, renamed('b'));
    await store.pull();
    expect(store.get('connection', id)?.value.label).toBe('ab');
  });

  it('waits out a dropped connection and lands a write whose answer was lost', async () => {
    const { accountId, vaultKey } = await server.account();
    let drop = false;
    const request = async <T,>(...args: Parameters<typeof api>) => {
      const result = await api<T>(...args);
      if (!drop || args[1] !== 'objects/batch') return result;
      drop = false;
      return { ok: false as const, error: 'offline' };
    };
    const store = await ObjectStore.open(accountId, vaultKey, serverBackend(request));
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      drop = true;
      const saving = store.update('connection', created.data.id, (current) => ({ ...current, label: 'b' }));
      await vi.waitFor(() => expect(store.waiting()).toBe(true));
      await vi.advanceTimersByTimeAsync(1500);
      expect(await saving).toMatchObject({ ok: true, data: { value: { label: 'b' } } });
      expect(store.waiting()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a batch's wait for a dropped connection when its caller stops it, and writes nothing after", async () => {
    const { accountId, vaultKey, store: other } = await server.account();
    let drop = false;
    const request = async <T,>(...args: Parameters<typeof api>) => (drop && args[1] === 'objects/batch' ? { ok: false as const, error: 'offline' } : api<T>(...args));
    const store = await ObjectStore.open(accountId, vaultKey, serverBackend(request));
    await store.pull();

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      drop = true;
      const stop = new AbortController();
      const saving = store.batch([{ type: 'create', kind: 'connection', id: crypto.randomUUID(), parent: null, value: connection('a') }], () => {}, { signal: stop.signal });
      await vi.waitFor(() => expect(store.waiting()).toBe(true));
      stop.abort();
      expect(await saving).toEqual({ ok: false, error: 'stopped' });
      drop = false;
      await vi.advanceTimersByTimeAsync(30_000);
    } finally {
      vi.useRealTimers();
    }
    await other.pull();
    expect(other.list('connection')).toEqual([]);
  });

  it('counts a body it cannot open and refuses to overwrite it', async () => {
    const { store: mine, open } = await server.account();
    const stranger = await open(randomBytes(32));
    const created = await stranger.create('connection', connection('x'));
    const id = created.ok ? created.data.id : '';

    await mine.pull();
    expect(mine.list('connection')).toEqual([]);
    expect(mine.unreadable()).toBe(1);
    expect(await mine.update('connection', id, renamed('y'))).toEqual({ ok: false, error: 'unreadable' });

    expect((await stranger.update('connection', id, renamed('z'))).ok).toBe(true);
    await mine.pull();
    expect(mine.unreadable()).toBe(1);
    expect((await stranger.remove(id)).ok).toBe(true);
    await mine.pull();
    expect(mine.unreadable()).toBe(0);
    if (!created.ok) throw new Error(created.error);
    expect((await mine.restore(created.data)).ok).toBe(true);
    expect(mine.unreadable()).toBe(0);
    expect(mine.list('connection').map(({ id }) => id)).toEqual([id]);
  });

  it('retries the whole batch after a later removal conflicts, without spending revs on the refused attempt', async () => {
    const { store: laptop, open } = await server.account();
    const a = await laptop.create('connection', connection('a'));
    const b = await laptop.create('connection', connection('b'));
    if (!a.ok || !b.ok) throw new Error('create failed');
    const phone = await open();
    await phone.pull();
    await laptop.update('connection', b.data.id, renamed('c'));

    expect(await phone.batch([
      { ...a.data, type: 'restore', value: connection('changed') },
      { type: 'remove', id: b.data.id },
    ])).toEqual({ ok: true, data: null });
    expect(phone.get('connection', a.data.id)).toMatchObject({ rev: 4, value: connection('changed') });
    await laptop.pull();
    expect(laptop.get('connection', a.data.id)).toEqual(phone.get('connection', a.data.id));
    expect(laptop.get('connection', b.data.id)).toBeNull();
  });

  it('splits by sealed request bytes, with the owner last and progress after each acknowledged object', async () => {
    const { accountId, vaultKey } = await server.account();
    const batches: { writes: { id: string; body: string }[] }[] = [];
    const request = async <T,>(...args: Parameters<typeof api>) => {
      if (args[1] === 'objects/batch') batches.push(args[2] as (typeof batches)[number]);
      return api<T>(...args);
    };
    const store = await ObjectStore.open(accountId, vaultKey, serverBackend(request));
    const id = crypto.randomUUID();
    await server.hold(store, id);
    const text = Array.from({ length: 16 }, () => toBase64(randomBytes(65_535))).join('');
    const writes: Write[] = [
      { type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {} } },
      ...Array.from({ length: 3 }, (_, at): Write => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent: id, value: { type: 'message', role: 'user', at, text, receipt: null } })),
    ];
    const progress: string[] = [];
    expect(await store.batch(writes, (write) => progress.push(write.id))).toEqual({ ok: true, data: null });
    expect(batches.flatMap(({ writes }) => writes).filter((write) => write.id === id)).toHaveLength(1);
    expect(progress).toEqual([...writes.slice(1), writes[0]!].map(({ id }) => id));
    for (const batch of batches) {
      expect(new TextEncoder().encode(JSON.stringify(batch)).length).toBeLessThanOrEqual(BATCH_LIMITS.bytes);
      expect(batch.writes.every(({ body }) => body.length <= BATCH_LIMITS.body)).toBe(true);
    }
    expect(store.children('entry', id).map(({ value }) => value)).toEqual(writes.slice(1).map((write) => 'value' in write && write.value));
    expect(store.get('chat', id)?.rev).toBe(4);
  });
});

describe('writes shown before their answer', () => {
  // hold keeps every objects/batch request waiting until answer: true sends it, false fails it.
  const gated = async () => {
    const { accountId, vaultKey, open } = await server.account();
    let gate: Promise<boolean> | null = null;
    let held = 0;
    let answer: (ok: boolean) => void = () => {};
    const request = async <T,>(...args: Parameters<typeof api>) => {
      if (gate && args[1] === 'objects/batch') {
        held++;
        if (!(await gate)) return { ok: false as const, error: 'server-error' };
      }
      return api<T>(...args);
    };
    const store = await ObjectStore.open(accountId, vaultKey, serverBackend(request));
    const hold = () => { gate = new Promise((resolve) => { answer = (ok) => { gate = null; resolve(ok); }; }); };
    return { store, open, hold, answer: (ok: boolean) => answer(ok), held: () => held };
  };

  it('shows a write at once, keeps it through a pull, and the confirmed object takes its place', async () => {
    const { store, open, hold, answer } = await gated();
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const phone = await open();
    await phone.pull();
    const told = vi.fn();
    store.subscribe(told);
    hold();
    const saving = store.update('connection', created.data.id, renamed('b'));
    await vi.waitFor(() => expect(store.get('connection', created.data.id)).toMatchObject({ rev: created.data.rev, pending: expect.any(Number), value: { label: 'ab' } }));
    expect(told).toHaveBeenCalled();
    await phone.update('connection', created.data.id, renamed('c'));
    await store.pull();
    expect(store.get('connection', created.data.id)?.value.label).toBe('ab');
    answer(true);
    const saved = await saving;
    expect(saved.ok && saved.data.value.label).toBe('acb');
    expect(saved.ok && store.get('connection', created.data.id)).toBe(saved.ok && saved.data);
    expect(store.get('connection', created.data.id)?.pending).toBeUndefined();
  });

  it('shows the confirmed copy again after a final failure, whose caller still hears it', async () => {
    const { store, hold, answer, held } = await gated();
    hold();
    const saving = store.create('connection', connection('a'), { id: 'c' });
    expect(store.get('connection', 'c')?.value.label).toBe('a');
    await vi.waitFor(() => expect(held()).toBe(1));
    answer(false);
    expect(await saving).toEqual({ ok: false, error: 'server-error' });
    expect(store.list('connection')).toEqual([]);
  });

  it.each([true, false])('keeps a later preview while the earlier write settles, then reapplies it to the confirmed copy (lands: %s)', async (lands) => {
    const { store, hold, answer, held } = await gated();
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const id = created.data.id;
    hold();
    const first = store.update('connection', id, renamed('b'));
    await vi.waitFor(() => expect(held()).toBe(1));
    const second = store.update('connection', id, renamed('c'));
    expect(store.get('connection', id)?.value.label).toBe('abc');
    expect(store.unsentWrites()).toBe(2);
    answer(lands);
    hold();
    try {
      expect((await first).ok).toBe(lands);
      await vi.waitFor(() => expect(held()).toBe(2));
      expect(store.get('connection', id)).toMatchObject({ pending: expect.any(Number), value: { label: 'abc' } });
      expect(store.unsentWrites()).toBe(1);
    } finally { answer(true); }
    expect(await second).toMatchObject({ ok: true, data: { value: { label: lands ? 'abc' : 'ac' } } });
    expect(store.get('connection', id)?.pending).toBeUndefined();
    expect(store.unsentWrites()).toBe(0);
  });

  it.each([true, false])('keeps later writes behind an in-flight write when an intervening queued write is cancelled (already queued: %s)', async (alreadyQueued) => {
    const { store, hold, answer, held } = await gated();
    const created = await store.create('connection', connection('a'));
    if (!created.ok) throw new Error(created.error);
    const id = created.data.id;
    hold();
    const first = store.update('connection', id, renamed('b'));
    await vi.waitFor(() => expect(held()).toBe(1));
    const stop = new AbortController();
    const cancelled = store.batch([{ type: 'restore', kind: 'connection', id, parent: null, value: connection('cancelled') }], undefined, { signal: stop.signal });
    const seen: string[] = [];
    const later = () => store.update('connection', id, (value) => { seen.push(value.label); return renamed('c')(value); });
    const queued = alreadyQueued ? later() : null;
    stop.abort();
    expect(await cancelled).toEqual({ ok: false, error: 'stopped' });
    const last = queued ?? later();
    try {
      // Only the preview runs before the earlier request answers; resolving against confirmed data would send early.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toEqual([alreadyQueued ? 'cancelled' : 'a']);
      expect(held()).toBe(1);
    } finally { answer(true); }
    expect((await first).ok).toBe(true);
    expect(await last).toMatchObject({ ok: true, data: { value: { label: 'abc' } } });
    expect(store.unsentWrites()).toBe(0);
  });

  it('counts a write as unsent from the moment it shows until its answer, landed or failed', async () => {
    const { store, hold, answer, held } = await gated();
    hold();
    const landing = store.create('connection', connection('a'));
    expect(store.unsentWrites()).toBe(1);
    await vi.waitFor(() => expect(held()).toBe(1));
    answer(true);
    expect((await landing).ok).toBe(true);
    expect(store.unsentWrites()).toBe(0);
    hold();
    const failing = store.create('connection', connection('b'));
    expect(store.unsentWrites()).toBe(1);
    await vi.waitFor(() => expect(held()).toBe(2));
    answer(false);
    expect((await failing).ok).toBe(false);
    expect(store.unsentWrites()).toBe(0);
  });

  it("keeps a pending entry in its chat's projection through a pull, after every confirmed one", async () => {
    const { store, open, hold, answer } = await gated();
    const phone = await open();
    const chat = await store.create('chat', { title: null, character: null, models: {} });
    if (!chat.ok) throw new Error(chat.error);
    const message = (text: string) => ({ type: 'message' as const, role: 'user' as const, text, at: 0, receipt: null });
    await server.hold(store, chat.data.id);
    await server.hold(phone, chat.data.id);
    const [mine, theirs] = [crypto.randomUUID(), crypto.randomUUID()];
    hold();
    const saving = store.create('entry', message('mine'), { id: mine, parent: chat.data.id });
    await vi.waitFor(async () => expect((await store.projections.evaluate(chat.data.id))?.model.messages.map(({ id }) => id)).toEqual([mine]));
    expect(await phone.create('entry', message('theirs'), { id: theirs, parent: chat.data.id })).toMatchObject({ ok: true });
    await store.refreshChat(chat.data.id);
    expect((await store.projections.evaluate(chat.data.id))?.model.messages.map(({ id }) => id)).toEqual([theirs, mine]);
    answer(true);
    expect(await saving).toMatchObject({ ok: true });
    expect((await store.projections.evaluate(chat.data.id))?.model.messages.map(({ id }) => id)).toEqual([theirs, mine]);
  });

  it.each([false, true])('never saves pending text in a summary before its write is confirmed (lands: %s)', async (lands) => {
    const { store, open, hold, answer, held } = await gated();
    const chat = await store.create('chat', { title: null, character: null, models: {} });
    if (!chat.ok) throw new Error(chat.error);
    const id = chat.data.id;
    await server.hold(store, id);
    await store.projections.save(id);
    const original = store.get('summary', summaryId(id))!;
    const phone = await open();
    hold();
    const saving = store.create('entry', { type: 'message', role: 'user', text: 'pending text', at: 0, receipt: null }, { parent: id });
    try {
      await vi.waitFor(() => expect(held()).toBe(1));
      expect((await store.projections.evaluate(id))?.summary.preview).toBe('pending text');
      expect(await store.projections.save(id)).toBeNull();
      expect(await store.projections.saveMany([id])).toBeNull();
      expect(held()).toBe(1);
      expect(store.get('summary', summaryId(id))?.rev).toBe(original.rev);
      await phone.pull();
      expect(phone.get('summary', summaryId(id))?.value.count).toBe(0);
      answer(lands);
      expect((await saving).ok).toBe(lands);
      await store.projections.save(id);
      await phone.pull();
      expect(phone.get('summary', summaryId(id))?.value).toMatchObject({ count: lands ? 1 : 0, preview: lands ? 'pending text' : '' });
    } finally {
      answer(false);
      await saving;
    }
  });
});
