import { ToolStorage } from './tools/store';
import { serverBackend } from './backend';
import { afterEach, expect, it, vi } from 'vitest';
import type { Connection } from '../connectors/types';
import { SETTINGS_ID } from '../model/settings';
import type { Ledger } from '../model/usage';
import { randomBytes } from '../vault/aead';
import { lockVault } from '../vault/device';
import { objectKey, sealObject } from '../vault/objects';
import { api } from './api';
import { forgetVault } from './device-cache';
import type { SealedChange } from '../contracts/objects';
import { openSession } from './session';
import { ObjectStore } from './store';
import { summaryId } from './summary';
import { Usage } from './usage';
import { exportBackup } from './testing/backup';
import { GENERATION_STEPS, generationSteps, MemoryCache } from './testing/cache';

vi.mock('../vault/device', () => ({ lockVault: vi.fn(async () => {}) }));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const limits = { items: 100, bytes: 1_000_000, body: 100_000 };
const connection = { type: 'openrouter', label: 'cached', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'secret' }], turns: null, starred: [] } satisfies Connection;

// A server as server/objects answers (tech-spec §5), whose timeline a restore replaces: restore(snapshot) rewinds the rows
// and the head to the snapshot, as a rewind of the account's store does.
async function fixture() {
  const vault = randomBytes(32);
  const key = await objectKey(vault);
  const cache = new MemoryCache();
  let rev = 0;
  let timeline = 't0';
  let resets = 0;
  const rows = new Map<string, SealedChange>();
  const add = async (id: string, kind: string, parent: string | null, value: unknown) => {
    const row = { id, kind, parent, rev: ++rev, body: value === null ? null : await sealObject(key, 'account', { id, kind, parent }, value) };
    rows.set(id, row);
    return row;
  };
  const refuse = () => {
    resets++;
    return Response.json({ error: 'cache-reset' }, { status: 409 });
  };
  const fetch = vi.fn(async (path: string, init: RequestInit) => {
    const url = new URL(path, 'https://test');
    if (init.method === 'POST') {
      const { timeline: sent, writes } = JSON.parse(init.body as string) as { timeline: string; writes: (Omit<SealedChange, 'rev'> & { once?: true })[] };
      if (sent !== timeline) return refuse();
      const revs = writes.map(({ once, ...write }) => {
        const landed = rows.get(write.id);
        if (once && landed?.body) return landed.rev;
        rows.set(write.id, { ...write, rev: ++rev });
        return rev;
      });
      return Response.json({ revs, timeline });
    }
    const since = Number(url.searchParams.get('since'));
    const known = Number(url.searchParams.get('known'));
    const sent = url.searchParams.get('timeline');
    if (sent === null ? since !== 0 || known !== 0 : sent !== timeline) return refuse();
    if (Math.max(since, known) > rev) return refuse();
    const parent = url.searchParams.get('parent');
    const bootstrap = url.searchParams.has('bootstrap');
    const changes = [...rows.values()].filter((row) => row.rev > since && (parent === null || row.parent === parent)).flatMap((row) => {
      if (!url.searchParams.get('exclude')?.split(',').includes(row.kind)) return [row];
      if (bootstrap) return [];
      const { body, ...metadata } = row;
      return [body === null ? row : { ...metadata, omitted: true as const }];
    }).sort((a, b) => a.rev - b.rev);
    return Response.json({ timeline, changes, cursor: changes.at(-1)?.rev ?? since, more: false, limits, ...(bootstrap ? { until: rev } : {}) });
  });
  vi.stubGlobal('fetch', fetch);
  const open = (request: typeof api = api, on = cache) => ObjectStore.open('account', vault, serverBackend(request), on);
  const flush = async (on = cache) => { await vi.waitFor(() => expect(on.states.get('')?.cursor).toBe(rev)); };
  const snapshot = () => ({ rows: new Map(rows), rev });
  const restore = (to: ReturnType<typeof snapshot>, next: string) => {
    rows.clear();
    for (const [id, row] of to.rows) rows.set(id, row);
    rev = to.rev;
    timeline = next;
  };
  return { vault, cache, rows, add, fetch, open, flush, snapshot, restore, resets: () => resets, wipe: () => { rows.clear(); rev = 0; } };
}

// A tab's own request path, whose answers can be held: computed by the server when sent, given to the tab when let go.
// It hears no stop, as an answer already on its way when the tab stops it does not.
function tab() {
  let holding: ((path: string) => boolean) | null = null;
  const held: (() => void)[] = [];
  const request = (async (...[method, path, body]: Parameters<typeof api>) => {
    const answer = api(method, path, body);
    if (holding?.(path)) await new Promise<void>((resolve) => held.push(resolve));
    return answer;
  }) as typeof api;
  return {
    request,
    hold: (match: (path: string) => boolean) => { holding = match; },
    held: () => held.length,
    release: () => {
      holding = null;
      for (const resolve of held.splice(0)) resolve();
    },
  };
}

const ids = (store: ObjectStore) => store.list('connection').map(({ id }) => id).toSorted();

// The store a restore ended, and the one the session opens after it (app/shell/Workspace).
async function after(store: ObjectStore, open: () => Promise<ObjectStore>) {
  await new Promise((resolve) => store.subscribeRewound(resolve));
  store.close();
  return open();
}

it('ends a late projection and summary job with the store a restore ended', async () => {
  const f = await fixture();
  await f.add('a', 'chat', null, { title: null, character: null, models: {} });
  await f.add('a1', 'entry', 'a', { type: 'message', role: 'user', text: 'restored', at: 0, receipt: null });
  const snapshot = f.snapshot();
  const store = await f.open();
  await store.pull();
  const lease = store.retainChat('a', { summarize: false });
  expect(await lease.ready).toBeNull();
  const seen: string[] = [];
  store.subscribe((changes) => {
    if (changes.some(({ kind }) => kind === 'projection')) seen.push(store.projections.get('a')?.summary.preview ?? '');
  });
  const display = store.evaluation.display.bind(store.evaluation);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  let signal: AbortSignal | undefined;
  vi.spyOn(store.evaluation, 'display').mockImplementationOnce(async (...args) => {
    const answer = await display(...args);
    signal = args[3];
    await gate;
    return answer;
  });
  await f.add('a1', 'entry', 'a', { type: 'message', role: 'user', text: 'obsolete', at: 0, receipt: null });
  const refreshing = store.refreshChat('a');
  await vi.waitFor(() => expect(signal).toBeDefined());
  const saving = store.projections.save('a');
  try {
    f.restore(snapshot, 'restored-timeline');
    expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
    expect(signal!.aborted).toBe(true);
    finish();
    await refreshing;
    expect(await saving).toEqual({ ok: false, error: 'timeline-changed' });
    expect(seen).not.toContain('obsolete');
    const next = await after(store, () => f.open());
    const held = next.retainChat('a', { summarize: false });
    expect(await held.ready).toBeNull();
    expect(next.projections.get('a')?.summary.preview).toBe('restored');
    expect(await next.projections.save('a')).toBeNull();
    expect(next.get('summary', summaryId('a'))?.value.preview).toBe('restored');
    held.release();
    next.close();
  } finally {
    finish();
    lease.release();
    store.close();
    await Promise.allSettled([refreshing, saving]);
  }
});

it('reopens a session with sealed cached objects before any network read', async () => {
  const f = await fixture();
  const sealed = await f.add('connection', 'connection', null, connection);
  const first = await f.open();
  await first.pull();
  await f.flush();
  first.close();
  expect(f.cache.rows.get('connection')).toEqual(sealed);
  expect(JSON.stringify(f.cache.rows.get('connection'))).not.toContain('secret');
  f.fetch.mockClear();
  f.fetch.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const opened = await openSession('account', f.vault, 'jin', new AbortController().signal, undefined, { backend: serverBackend(), cache: f.cache });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(opened.data.store.get('connection', 'connection')?.value.label).toBe('cached');
  expect(f.fetch).not.toHaveBeenCalled();
  opened.data.startBackground();
  expect(f.fetch).toHaveBeenCalledWith('/api/objects?since=1&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&timeline=t0', expect.anything());
  opened.data.close();
});

it('opens the session again on the restored account when its opening pull hears a restore', async () => {
  const f = await fixture();
  await f.add('kept', 'connection', null, connection);
  f.fetch.mockImplementationOnce(async () => Response.json({ error: 'cache-reset' }, { status: 409 }));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  const opened = await openSession('account', f.vault, 'jin', new AbortController().signal, undefined, { backend: serverBackend(), cache: f.cache });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  expect(ids(opened.data.store)).toEqual(['kept']);
  expect(f.fetch.mock.calls.filter(([path]) => path.includes('bootstrap=1'))).toHaveLength(2);
  opened.data.close();
});

it('renders a saved bootstrap prefix and resumes its original until bound in the background', async () => {
  const f = await fixture();
  await f.add('first', 'connection', null, connection);
  await f.add('second', 'connection', null, connection);
  const respond = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementationOnce(async (...args) => {
    const data = await (await respond(...args)).json() as { changes: SealedChange[] };
    return Response.json({ ...data, changes: data.changes.slice(0, 1), cursor: 1, more: true });
  }).mockImplementationOnce(async () => Response.json({ error: 'offline' }, { status: 503 }));
  const first = await f.open();
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  let pulling: Promise<unknown>;
  try {
    pulling = first.pull();
    await vi.waitFor(() => expect(first.waiting()).toBe(true));
    await vi.waitFor(() => expect(f.cache.states.get('')).toMatchObject({ cursor: 1, until: 2, complete: false }));
  } finally {
    vi.useRealTimers();
  }
  first.close();
  expect(await pulling).toMatchObject({ error: 'stopped' });
  f.fetch.mockClear();
  f.fetch.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'visible' });
  const opened = await openSession('account', f.vault, 'jin', new AbortController().signal, undefined, { backend: serverBackend(), cache: f.cache });
  if (!opened.ok) throw new Error(opened.error);
  expect(opened.data.store.list('connection').map((row) => row.id)).toEqual(['first']);
  expect(f.fetch).not.toHaveBeenCalled();
  opened.data.startBackground();
  expect(f.fetch.mock.lastCall?.[0]).toBe('/api/objects?since=1&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1&until=2&count=1&known=2&timeline=t0');
  opened.data.close();
});

it('settles a retained cached chat before its parent catch-up, then applies newer entries', async () => {
  const f = await fixture();
  await f.add('chat', 'chat', null, { title: null, character: null, models: {} });
  await f.add('old', 'entry', 'chat', { type: 'delete', message: 'old', at: 1 });
  const store = await f.open();
  await store.pull();
  const first = store.retainChat('chat');
  expect(await first.ready).toBeNull();
  first.release();
  await f.add('new', 'entry', 'chat', { type: 'delete', message: 'new', at: 2 });
  const respond = f.fetch.getMockImplementation()!;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { resume = resolve; });
  f.fetch.mockImplementation(async (...args) => { await waiting; return respond(...args); });
  const next = store.retainChat('chat');
  expect(await next.ready).toBeNull();
  expect(store.children('entry', 'chat').map((row) => row.id)).toEqual(['old']);
  expect(f.fetch.mock.lastCall?.[0]).toContain('since=2&parent=chat');
  resume();
  await vi.waitFor(() => expect(store.children('entry', 'chat').map((row) => row.id)).toEqual(['old', 'new']));
  next.release();
  store.close();
});

it('does not serve an unloaded chat deletion from the cache on its next retain', async () => {
  const f = await fixture();
  await f.add('entry', 'entry', 'chat', { type: 'delete', message: 'old', at: 1 });
  const store = await f.open();
  await store.pull();
  const first = store.retainChat('chat');
  await first.ready;
  first.release();
  await f.add('entry', 'entry', 'chat', null);
  await store.pull();
  f.fetch.mockImplementation(() => new Promise(() => {}));
  const next = store.retainChat('chat');
  expect(await next.ready).toBeNull();
  expect(store.children('entry', 'chat')).toEqual([]);
  next.release();
  store.close();
});

it('requires a parent catch-up when an unloaded cached body was omitted by the main feed', async () => {
  const f = await fixture();
  await f.add('memory', 'memory', 'chat', { records: [], chapters: [], state: [], threads: [] });
  const store = await f.open();
  await store.pull();
  const first = store.retainChat('chat');
  await first.ready;
  first.release();
  await f.add('memory', 'memory', 'chat', { records: [], chapters: [], state: [], threads: [{ id: 'new', text: 'new', opened: null }] });
  await store.pull();
  const respond = f.fetch.getMockImplementation()!;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { resume = resolve; });
  f.fetch.mockImplementation(async (...args) => { await waiting; return respond(...args); });
  const next = store.retainChat('chat');
  await vi.waitFor(() => expect(f.fetch.mock.lastCall?.[0]).toContain('since=1&parent=chat'));
  expect(() => store.children('memory', 'chat')).toThrow('not loaded');
  resume();
  expect(await next.ready).toBeNull();
  expect(store.children('memory', 'chat')[0]?.value.threads[0]?.id).toBe('new');
  next.release();
  store.close();
});

it('drops the cached account instead of merging when server revisions go backwards', async () => {
  const f = await fixture();
  await f.add('connection', 'connection', null, connection);
  const first = await f.open();
  await first.pull();
  await f.flush();
  first.close();
  const reopened = await f.open();
  expect(reopened.get('connection', 'connection')).not.toBeNull();
  f.wipe();
  expect(await reopened.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  const next = await after(reopened, () => f.open());
  expect(f.cache.rows.size).toBe(0);
  expect(await next.pull()).toBeNull();
  expect(next.list('connection')).toEqual([]);
  expect(f.cache.states.get('')?.cursor).toBe(0);
  next.close();
});

it('forgets the account cache together with its remembered vault on logout', async () => {
  const f = await fixture();
  await f.add('connection', 'connection', null, connection);
  const store = await f.open();
  await store.pull();
  await f.flush();
  store.close();
  await forgetVault('account', f.cache);
  expect(lockVault).toHaveBeenCalled();
  expect(f.cache.generation).toBeUndefined();
  expect(f.cache.rows.size).toBe(0);
});

it('does not await a cache write or fail a successful object write when caching fails', async () => {
  const f = await fixture();
  const store = await f.open();
  await store.pull();
  await f.flush();
  let reject!: (reason: Error) => void;
  const writing = vi.spyOn(f.cache, 'write').mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const saved = await store.create('connection', { ...connection, starred: [] });
  expect(saved.ok).toBe(true);
  await vi.waitFor(() => expect(writing).toHaveBeenCalledOnce());
  const write = writing.mock.calls[0]![1].changes[0]!;
  expect(write.body).toBe(f.rows.get(write.id)?.body);
  reject(new Error('quota'));
  expect((await store.create('connection', { ...connection, starred: [] })).ok).toBe(true);
  store.close();
});

it('keeps the generation rules a browser cache keeps', async () => {
  expect(await generationSteps(new MemoryCache())).toEqual(GENERATION_STEPS);
});

it('discards a cache from before generations instead of reading its rows', async () => {
  const f = await fixture();
  await f.add('server', 'connection', null, connection);
  f.cache.rows.set('old', { id: 'old', kind: 'connection', parent: null, rev: 9, body: 'sealed' });
  f.cache.states.set('', { cursor: 9, complete: true, until: null, limits, heads: [], revisions: [] });
  const store = await f.open();
  expect(store.cached).toBe(false);
  expect(await store.pull()).toBeNull();
  expect(ids(store)).toEqual(['server']);
  await f.flush();
  expect([...f.cache.rows.keys()]).toEqual(['server']);
  store.close();
});

it('ends the store at a restore and at its undo, and the store opened after each holds the server rows', async () => {
  const f = await fixture();
  await f.add('kept', 'connection', null, connection);
  const before = f.snapshot();
  await f.add('later', 'connection', null, connection);
  const store = await f.open();
  await store.pull();
  await f.flush();
  const told = vi.fn();
  store.subscribeRewound(told);
  const checkpoint = f.snapshot();

  f.restore(before, 't1');
  expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  const restored = await after(store, () => f.open());
  expect(told.mock.calls).toEqual([[0]]);
  expect(f.cache.rows.size).toBe(0);
  expect(await restored.pull()).toBeNull();
  expect(ids(restored)).toEqual(['kept']);
  await vi.waitFor(() => expect(f.cache.generation?.timeline).toBe('t1'));
  await f.flush();
  expect([...f.cache.rows.keys()]).toEqual(['kept']);

  f.restore(checkpoint, 't2');
  expect(await restored.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  const undone = await after(restored, () => f.open());
  expect(await undone.pull()).toBeNull();
  expect(ids(undone)).toEqual(['kept', 'later']);
  expect((await undone.create('connection', { ...connection, starred: [] })).ok).toBe(true);
  expect(await undone.pull()).toBeNull();
  expect(f.resets()).toBe(2);
  await vi.waitFor(() => expect(f.cache.generation?.timeline).toBe('t2'));
  await f.flush();
  expect([...f.cache.rows.keys()].toSorted()).toEqual([...f.rows.keys()].toSorted());
  undone.close();
});

it('tells a restore at once, and the store opened after it opens the device copy only once cleared', async () => {
  const f = await fixture();
  await f.add('kept', 'connection', null, connection);
  const before = f.snapshot();
  await f.add('later', 'connection', null, connection);
  const store = await f.open();
  await store.pull();
  await f.flush();
  const clear = MemoryCache.prototype.clear.bind(f.cache);
  let release!: () => void;
  vi.spyOn(f.cache, 'clear').mockImplementationOnce(async (stated) => {
    await new Promise<void>((resolve) => { release = resolve; });
    return clear(stated);
  });
  const told = vi.fn();
  store.subscribeRewound(told);

  f.restore(before, 't1');
  expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  expect(told.mock.calls).toEqual([[0]]);
  store.close();
  const read = vi.spyOn(f.cache, 'open');
  const opening = f.open();
  await vi.waitFor(() => expect(release).toBeDefined());
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(read).not.toHaveBeenCalled();
  release();
  const next = await opening;
  expect(next.cached).toBe(false);
  expect(await next.pull()).toBeNull();
  expect(ids(next)).toEqual(['kept']);
  next.close();
});

it('opens the store after a restore without the device copy when its clear failed, after a failed write too', async () => {
  const f = await fixture();
  await f.add('kept', 'connection', null, connection);
  const before = f.snapshot();
  const store = await f.open();
  await store.pull();
  await f.flush();
  vi.spyOn(f.cache, 'write').mockRejectedValueOnce(new Error('quota'));
  await f.add('later', 'connection', null, connection);
  expect(await store.pull()).toBeNull();
  const cleared = vi.spyOn(f.cache, 'clear').mockRejectedValue(new Error('broken'));

  f.restore(before, 't1');
  expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  const next = await after(store, () => f.open());
  expect(cleared).toHaveBeenCalledOnce();
  expect(next.cached).toBe(false);
  expect(await next.pull()).toBeNull();
  expect(ids(next)).toEqual(['kept']);
  expect(f.resets()).toBe(1);
  next.close();
});

it('aborts the page a pull is waiting on when its store ends', async () => {
  const f = await fixture();
  const signals: AbortSignal[] = [];
  const store = await f.open(((method, path, body, signal) => {
    if (path.startsWith('objects?')) signals.push(signal!);
    return api(method, path, body, signal);
  }) as typeof api);
  const pulling = store.pull({ signal: new AbortController().signal });
  await vi.waitFor(() => expect(signals).toHaveLength(1));
  store.close();
  expect(signals[0]!.aborted).toBe(true);
  expect(await pulling).toEqual({ ok: false, error: 'stopped' });
});

it('drops and counts a write a restore cut short, whose late 409 or 503 neither lands nor ends the next store', async () => {
  for (const late of [Response.json({ error: 'cache-reset' }, { status: 409 }), Response.json({ error: 'account-restoring', retryAfter: 1 }, { status: 503 })]) {
    const f = await fixture();
    await f.add('kept', 'connection', null, connection);
    const writer = tab();
    const store = await f.open(writer.request);
    await store.pull();
    const told = vi.fn();
    store.subscribeRewound(told);
    let answer!: (response: Response) => void;
    f.fetch.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const writing = store.create('connection', { ...connection, starred: [] });
    await vi.waitFor(() => expect(answer).toBeDefined());

    f.restore(f.snapshot(), 't1');
    expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
    const next = await after(store, () => f.open(writer.request));
    expect(told.mock.calls).toEqual([[1]]);
    answer(late);
    expect(await writing).toEqual({ ok: false, error: 'timeline-changed' });
    expect(f.resets()).toBe(1);
    expect(await next.pull()).toBeNull();
    expect(ids(next)).toEqual(['kept']);
    expect((await next.create('connection', { ...connection, starred: [] }, { id: 'new' })).ok).toBe(true);
    expect([...f.rows.keys()]).toEqual(['kept', 'new']);
    next.close();
  }
});

it('waits out a restore under way for the time the 503 names, then drops and counts the write the restore left behind', async () => {
  const f = await fixture();
  const store = await f.open();
  await store.pull();
  const told = vi.fn();
  store.subscribeRewound(told);
  f.fetch.mockImplementationOnce(async () => {
    f.restore(f.snapshot(), 't1');
    return Response.json({ error: 'account-restoring', retryAfter: 0.05 }, { status: 503 });
  });
  const writing = store.create('connection', { ...connection, starred: [] });
  await vi.waitFor(() => expect(store.waiting()).toBe(true));
  expect(await writing).toEqual({ ok: false, error: 'timeline-changed' });
  expect(told.mock.calls).toEqual([[1]]);
  expect(f.rows.size).toBe(0);
  store.close();
});

it('answers timeline-changed to a chat opening a restore cut short, and the next store opens the chat', async () => {
  const f = await fixture();
  await f.add('chat', 'chat', null, { title: null, character: null, models: {} });
  await f.add('old', 'entry', 'chat', { type: 'delete', message: 'old', at: 1 });
  const store = await f.open();
  await store.pull();
  const respond = f.fetch.getMockImplementation()!;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { resume = resolve; });
  f.fetch.mockImplementation(async (path, init) => {
    if (path.includes('parent=chat')) await waiting;
    return respond(path, init);
  });
  const cut = store.retainChat('chat');
  await vi.waitFor(() => expect(f.fetch.mock.lastCall?.[0]).toContain('parent=chat'));
  f.restore(f.snapshot(), 't1');
  expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  resume();
  expect(await cut.ready).toEqual({ ok: false, error: 'timeline-changed' });
  cut.release();
  const next = await after(store, () => f.open());
  const again = next.retainChat('chat');
  expect(await again.ready).toBeNull();
  expect(next.children('entry', 'chat').map(({ id }) => id)).toEqual(['old']);
  again.release();
  next.close();
});

it('ends a pinned workflow at a restore: a write it makes after it is refused before it is sent', async () => {
  const f = await fixture();
  await f.add('kept', 'connection', null, connection);
  const store = await f.open();
  await store.pull();
  const result = await store.pinned(async () => {
    f.restore(f.snapshot(), 't1');
    expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
    return store.create('connection', { ...connection, starred: [] }, { id: 'late' });
  });
  expect(result).toEqual({ ok: false, error: 'timeline-changed' });
  expect(f.fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toEqual([]);
  store.close();
});

it('fails an export whose timeline changes between its two scans, writing no archive', async () => {
  const f = await fixture();
  await f.add('kept', 'connection', null, connection);
  const store = await f.open();
  await store.pull();
  const respond = f.fetch.getMockImplementation()!;
  f.fetch.mockImplementation(async (path, init) => {
    if (path.includes('since=0&timeline=')) f.restore(f.snapshot(), 't1');
    return respond(path, init);
  });
  const output = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  expect(await exportBackup(store, { read: vi.fn(), missing: vi.fn() }, output)).toEqual({ ok: false, error: 'timeline-changed' });
  expect(output.close).not.toHaveBeenCalled();
  expect(output.abort).toHaveBeenCalled();
  store.close();
});

it('lets a stale tab’s delayed clear and delayed bootstrap change nothing: both tabs end on the newest timeline', async () => {
  const f = await fixture();
  await f.add('kept', 'connection', null, connection);
  const before = f.snapshot();
  await f.add('later', 'connection', null, connection);
  const a = tab();
  const b = tab();
  const first = await f.open(a.request);
  await first.pull();
  await f.flush();
  const second = await f.open(b.request);
  expect(second.cached).toBe(true);
  const checkpoint = f.snapshot();
  const refused: string[] = [];
  const clear = MemoryCache.prototype.clear.bind(f.cache);
  const adopt = MemoryCache.prototype.adopt.bind(f.cache);
  vi.spyOn(f.cache, 'clear').mockImplementation((stated) => clear(stated).catch((error: unknown) => { refused.push('clear'); throw error; }));
  vi.spyOn(f.cache, 'adopt').mockImplementation((stated, timeline) => adopt(stated, timeline).catch((error: unknown) => { refused.push(`adopt ${timeline}`); throw error; }));

  // A restore: the first tab's store ends and clears the cache; the one opened after it asks for its bootstrap, whose
  // answer (of t1) is held.
  f.restore(before, 't1');
  const generation = f.cache.generation!.id;
  expect(await first.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  const firstNext = await after(first, () => f.open(a.request));
  expect(f.cache.generation?.id).not.toBe(generation);
  a.hold((path) => !path.includes('timeline='));
  const firstPull = firstNext.pull();
  await vi.waitFor(() => expect(a.held()).toBe(1));
  // Its undo, which the second tab hears first: its own clear is now a stale tab's, and the next store bootstraps t2.
  f.restore(checkpoint, 't2');
  expect(await second.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  const secondNext = await after(second, () => f.open(b.request));
  expect(await secondNext.pull()).toBeNull();
  await vi.waitFor(() => expect(f.cache.generation?.timeline).toBe('t2'));
  // The first tab's delayed bootstrap cannot adopt t1 in a cache that moved on: that store ends too, and the next reads t2.
  a.release();
  await firstPull;
  const firstLast = await after(firstNext, () => f.open(a.request));
  expect(await firstLast.pull()).toBeNull();
  expect(ids(firstLast)).toEqual(['kept', 'later']);
  expect(ids(secondNext)).toEqual(['kept', 'later']);
  expect(f.cache.generation?.timeline).toBe('t2');
  expect(refused).toEqual(['clear', 'adopt t1']);
  await f.flush();
  expect([...f.cache.rows.keys()].toSorted()).toEqual(['kept', 'later']);
  firstLast.close();
  secondNext.close();
});

it('aborts an export when the timeline changes while its final picture is being read', async () => {
  const f = await fixture();
  await f.add('character', 'character', null, {});
  await f.add('asset', 'asset', 'character', { name: 'picture', file: { id: 'picture', key: 'key' } });
  const store = await f.open();
  await store.pull();
  const output = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const files = {
    missing: vi.fn(async () => ({ ok: true as const, data: { missing: new Set<string>(), maxBytes: 0, room: null } })),
    read: vi.fn(async () => {
      f.restore(f.snapshot(), 't1');
      await store.pull();
      return { ok: true as const, data: new Uint8Array([1]) };
    }),
  };
  try {
    const result = await exportBackup(store, files, output);
    expect(files.read).toHaveBeenCalledOnce();
    expect({ result, closed: output.close.mock.calls.length, aborted: output.abort.mock.calls.length }).toEqual({
      result: { ok: false, error: 'timeline-changed' }, closed: 0, aborted: 1,
    });
  } finally {
    store.close();
  }
});

it('walks the ledger from the device cache and past its cursor, and a store opened after a restore reads it whole', async () => {
  const f = await fixture();
  const call = (id: string) => ({ type: 'call', at: 1, call: { id, connection: 'c', model: 'm', modelName: 'model', source: 'source', usage: null, cost: null }, chat: null, character: null });
  await f.add('first', 'ledger', SETTINGS_ID, call('first'));
  const original = f.snapshot();
  const calls = async (usage: Usage) => {
    const read = await usage.read(new AbortController().signal);
    return read.ok ? read.data.map(({ call }) => call.id).toSorted() : read;
  };
  const walks = () => f.fetch.mock.calls.flatMap(([path]) => (path.includes(`parent=${SETTINGS_ID}`) ? [new URL(path, 'https://test').searchParams.get('since')] : []));
  const store = await f.open();
  const usage = new Usage(store);
  expect(await calls(usage)).toEqual(['first']);
  await vi.waitFor(() => expect(f.cache.states.get(SETTINGS_ID)?.cursor).toBe(1));
  usage.close();
  store.close();

  await f.add('second', 'ledger', SETTINGS_ID, call('second'));
  const again = await f.open();
  const reopened = new Usage(again);
  expect(await calls(reopened)).toEqual(['first', 'second']);
  expect(walks()).toEqual(['0', '1']);
  f.restore({ rows: new Map(), rev: 2 }, 't1');
  expect(await calls(reopened)).toEqual({ ok: false, error: 'timeline-changed' });
  reopened.close();
  const restored = await after(again, () => f.open());
  const read = new Usage(restored);
  expect(await calls(read)).toEqual([]);
  read.close();
  f.restore(original, 't2');
  expect(await restored.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  const undone = await after(restored, () => f.open());
  const readAgain = new Usage(undone);
  expect(await calls(readAgain)).toEqual(['first']);
  readAgain.close();
  undone.close();
});

it('caches the row the server keeps, never the body a once write sent for a row already there', async () => {
  const f = await fixture();
  const call = (chat: string): Ledger => ({ type: 'call', at: 1, call: { id: 'call', connection: 'c', model: 'm', modelName: 'model', source: 'source', usage: null, cost: null }, chat, character: null });
  await f.add('row', 'ledger', SETTINGS_ID, call('original'));
  const chats = async (store: ObjectStore) => {
    const usage = new Usage(store);
    const read = await usage.read(new AbortController().signal);
    usage.close();
    return read.ok ? read.data.map(({ chat }) => chat) : read;
  };
  const store = await f.open();
  await store.pull();
  expect((await store.batch([{ type: 'create', kind: 'ledger', id: 'row', parent: SETTINGS_ID, value: call('branch') }])).ok).toBe(true);
  expect(await chats(store)).toEqual(['original']);
  await vi.waitFor(() => expect(f.cache.states.get(SETTINGS_ID)?.cursor).toBe(1));
  store.close();
  expect(await chats(await f.open())).toEqual(['original']);
});

it('fences a tool write across the merge pause when a restore ends the store', async () => {
  const f = await fixture();
  await f.add('module', 'module', null, { name: 'tool', description: '', namespace: null, loreFolders: [], regex: [], triggers: [], toggles: [] });
  const store = await f.open();
  await store.pull();
  // A value its row holds reads and writes no file.
  const writes = new ToolStorage({ store, files: null as never });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const pending = writes.write('module', 'note', 'before restore');
    const refused = expect(pending).rejects.toThrow('timeline-changed');
    await vi.advanceTimersByTimeAsync(0);
    f.restore(f.snapshot(), 't1');
    expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
    await vi.advanceTimersByTimeAsync(1001);
    await refused;
    expect(f.fetch.mock.calls.filter(([, init]) => init.method === 'POST')).toEqual([]);
  } finally { writes.close(); store.close(); vi.useRealTimers(); }
});
