import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverBackend } from './backend';
import type { Card } from '../engine/import/types';
import * as chatModel from '../model/chat';
import type { Chat } from '../model/chat';
import { randomBytes } from '../vault/aead';
import * as sealedObjects from '../vault/objects';
import { exportBackup, readBackup } from './testing/backup';
import { removeChat, restoreChat } from './chat-log';
import { Files } from './files';
import { backfillSummaries, saveSummaries, summaryId, summaryStale } from './summary';
import type { api, ApiResult } from './api';
import { EvaluationFailed, EvaluationStuck } from './evaluation';
import { plainDisplay, ReadModels } from './read-model';
import { planRemoval } from './removal';
import { openSession } from './session';
import { Streams } from './streams';
import { ObjectStore } from './store';
import type { StoreChange } from './object-index';
import type { Turn } from './talk';

type Wire = StoreChange & { rev: number; body: string | null };
async function account() {
  const changes = new Map<string, Wire>();
  let rev = 0;
  const paths: string[] = [];
  const request: typeof api = async <T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> => {
    paths.push(path);
    if (method === 'GET') {
      const params = new URL(path, 'https://test/').searchParams;
      const since = Number(params.get('since'));
      const excluded = (params.get('exclude') ?? '').split(',');
      const parent = params.get('parent');
      const bootstrap = params.get('bootstrap') === '1';
      const until = Number(params.get('until') ?? rev);
      const candidates = [...changes.values()].filter((change) => change.rev > since
        && (parent === null || change.parent === parent)
        && (!bootstrap || (change.rev <= until && !excluded.includes(change.kind))))
        .sort((a, b) => a.rev - b.rev);
      const page = candidates.slice(0, 2).map(({ body, ...row }) => body !== null && (excluded.includes(row.kind) || params.has('metadata')) ? { ...row, omitted: true } : { ...row, body });
      const cursor = page.at(-1)?.rev ?? since;
      return { ok: true, data: { timeline: 't', changes: page, cursor, more: candidates.length > page.length, ...(bootstrap && { until }), limits: { items: 100, bytes: 1_000_000, body: 100_000 } } as T };
    }
    const writes = (body as { writes: (Omit<Wire, 'rev'> & { baseRev: number | null })[] }).writes;
    if (writes.some((write) => (changes.get(write.id)?.rev ?? null) !== write.baseRev)) return { ok: false, error: 'conflict' };
    const revs = writes.map(({ id, kind, parent, body }) => {
      changes.set(id, { id, kind, parent, body, rev: ++rev });
      return rev;
    });
    return { ok: true, data: { revs, timeline: 't' } as T };
  };
  const key = randomBytes(32);
  const open = async () => {
    const store = await ObjectStore.open('account', key, serverBackend(request));
    await store.pull();
    return store;
  };
  const seed = async (id: string, kind: string, parent: string | null, value: unknown) => {
    const body = await sealedObjects.sealObject(await sealedObjects.objectKey(key), 'account', { id, kind, parent }, value);
    changes.set(id, { id, kind, parent, body, rev: ++rev });
  };
  return { store: await open(), open, seed, paths, request, key };
}

async function hold(store: ObjectStore, ...ids: string[]) {
  const leases = ids.map((id) => store.retainChat(id));
  for (const lease of leases) expect(await lease.ready).toBeNull();
  return () => leases.forEach((lease) => lease.release());
}

const NO_DRAWINGS = { snapshot: () => new Map(), subscribe: () => () => true };
const chat: Chat = { title: null, character: null, models: {} };
const message = (text: string) => ({ type: 'message' as const, role: 'user' as const, text, at: 0, receipt: null });
const card = (name: string): Card => ({ name, nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false, bias: [], regex: [], triggers: [], loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } });
const liveTalk = () => {
  let turn: Turn | null = null;
  const listeners = new Set<() => void>();
  return {
    snapshot: (chat: string) => (turn?.chat === chat ? turn : null),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    set: (next: Turn | null) => { turn = next; for (const listener of listeners) listener(); },
  };
};

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('selective account reads', () => {
  it('opens home and every list from summaries without decrypting, folding or displaying entries', async () => {
    const { store, request, key } = await account();
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: chat },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('hello') },
    ]);
    // The summary is saved after the batch answers; the session below must open with it already on the server.
    await vi.waitFor(() => expect(store.list('summary')).toHaveLength(1));
    const decrypt = vi.spyOn(sealedObjects, 'openObject');
    const folded = vi.spyOn(chatModel.ChatFold.prototype, 'snapshot');
    const displayed = vi.spyOn(store.evaluation, 'display');
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      const answer = await request(init.method as 'GET' | 'POST', url.slice('/api/'.length), init.body ? JSON.parse(init.body as string) : undefined);
      return Response.json(answer.ok ? answer.data : answer, { status: answer.ok ? 200 : 500 });
    });
    const opened = await openSession('account', key, 'Jin', new AbortController().signal);
    if (!opened.ok) throw new Error(opened.error);
    const { read } = opened.data;
    expect(read.chats.snapshot()).toMatchObject([{ title: 'hello', preview: 'hello', count: 1 }]);
    expect(read.library.snapshot().none.chats).toEqual(read.chats.snapshot());
    expect(read.summary('a').snapshot()?.title).toBe('hello');
    expect(read.chat('a').snapshot()).toBeNull();
    expect(decrypt.mock.calls.some(([, , address]) => address.kind === 'entry' || address.kind === 'memory')).toBe(false);
    expect(folded).not.toHaveBeenCalled();
    expect(displayed).not.toHaveBeenCalled();
    opened.data.close();
  });

  it('coalesces a chat scope load, refuses unloaded reads and releases entries and display after its last holder', async () => {
    const { seed, open, paths } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('held'));
    const store = await open();
    const read = new ReadModels(store);
    expect(() => store.children('entry', 'a')).toThrow('not loaded');
    expect(() => store.get('entry', 'a1')).toThrow('not loaded');
    const first = store.retainChat('a');
    const second = store.retainChat('a');
    expect(store.scopeState('a')).toBe('loading');
    expect(await first.ready).toBeNull();
    expect(await second.ready).toBeNull();
    expect(paths.filter((path) => path.includes('parent=a'))).toHaveLength(1);
    expect(read.chat('a').snapshot()?.messages).toHaveLength(1);
    first.release();
    expect(store.scopeState('a')).toBe('loaded');
    second.release();
    expect(store.scopeState('a')).toBe('unloaded');
    expect(read.chat('a').snapshot()).toBeNull();
    expect(store.projections.get('a')).toBeNull();
    expect(() => store.get('entry', 'a1')).toThrow('not loaded');
    expect(read.chats.snapshot()[0]?.preview).toBe('held');
    read.close();
  });

  it('detects entry-head and display-dependency staleness and rebuilds the bounded encrypted projection on load', async () => {
    const { store, seed, open } = await account();
    await seed('persona', 'persona', null, { name: 'Jin', description: '', picture: null });
    await seed('ca', 'character', null, { card: card('Luna'), folder: null, loreFolders: [] });
    for (let index = 0; index < 10; index++) await seed(`asset${index}`, 'asset', 'ca', { name: `asset${index}`, type: 'image/png', size: 1, file: { id: '0'.repeat(64), key: 'key' } });
    await store.pull();
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: { ...chat, persona: 'persona', character: 'ca' } },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('{{user}}, hello') },
    ]);
    const device = await open();
    const original = device.get('summary', summaryId('a'))!.value;
    expect(original).toMatchObject({ title: 'Jin, hello', count: 1, version: 1 });
    expect(original.dependencies.filter((read) => read.kind === 'asset')).toEqual([{ kind: 'asset', parent: 'ca', rev: expect.any(Number) }]);
    expect(summaryStale(device, 'a', original)).toBe(false);
    expect(summaryStale(device, 'a', { ...original, version: 0 })).toBe(true);
    await seed('persona', 'persona', null, { name: 'Mina', description: '', picture: null });
    await seed('a2', 'entry', 'a', message('x'.repeat(500)));
    await device.pull();
    expect(summaryStale(device, 'a', original)).toBe(true);
    expect(device.scopeState('a')).toBe('unloaded');
    const lease = device.retainChat('a');
    expect(await lease.ready).toBeNull();
    const rebuilt = device.get('summary', summaryId('a'))!.value;
    expect(rebuilt).toMatchObject({ title: 'Mina, hello', count: 2, preview: 'x'.repeat(256) });
    expect(summaryStale(device, 'a', rebuilt)).toBe(false);
    lease.release();
  });

  it("waits out a dropped connection on a chat's first page instead of failing the scope", async () => {
    const { seed, request, key } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('not lost'));
    let offline = true;
    const flaky: typeof api = (method, path, body, signal) => offline && path.includes('parent=a')
      ? Promise.resolve({ ok: false, error: 'offline' }) : request(method, path, body, signal);
    const store = await ObjectStore.open('account', key, serverBackend(flaky));
    await store.pull();
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const lease = store.retainChat('a');
      await vi.waitFor(() => expect(store.waiting()).toBe(true));
      expect(store.scopeState('a')).toBe('loading');
      expect(() => store.children('entry', 'a')).toThrow('not loaded');
      offline = false;
      await vi.advanceTimersByTimeAsync(1500);
      expect(await lease.ready).toBeNull();
      expect(store.waiting()).toBe(false);
      expect(store.projections.get('a')?.model.messages).toHaveLength(1);
      lease.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an abandoned scope load instead of retaining its decrypted messages', async () => {
    const { seed, request, key } = await account();
    await seed('a', 'chat', null, chat);
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { started = resolve; });
    const delayed: typeof api = (method, path, body, signal) => {
      if (!path.includes('parent=a')) return request(method, path, body, signal);
      started();
      return new Promise((resolve) => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }), { once: true }));
    };
    const store = await ObjectStore.open('account', key, serverBackend(delayed));
    await store.pull();
    const lease = store.retainChat('a');
    await waiting;
    lease.release();
    expect(await lease.ready).toEqual({ ok: false, error: 'stopped' });
    expect(store.scopeState('a')).toBe('unloaded');
    expect(store.projections.get('a')).toBeNull();
  });

  it('refreshes held memory on a conflict before reapplying the edit', async () => {
    const { store, open } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('memory', { records: [], chapters: [], state: [], threads: [] }, { id: 'memory', parent: 'a' });
    const phone = await open();
    const release = await hold(store, 'a');
    const releasePhone = await hold(phone, 'a');
    await store.update('memory', 'memory', (memory) => ({ ...memory, threads: [{ id: 'first', text: 'first', opened: null }] }));
    const saved = await phone.update('memory', 'memory', (memory) => ({ ...memory, threads: [...memory.threads, { id: 'second', text: 'second', opened: null }] }));
    expect(saved.ok && saved.data.value.threads.map(({ id }) => id)).toEqual(['first', 'second']);
    release();
    releasePhone();
  });

  it('cancels projection work only at the last lease and drops a late answer after release', async () => {
    const { store, seed } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('original'));
    await store.pull();
    const first = store.retainChat('a', { summarize: false });
    const second = store.retainChat('a', { summarize: false });
    await Promise.all([first.ready, second.ready]);
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
    await seed('a2', 'entry', 'a', message('late'));
    const refreshing = store.refreshChat('a');
    try {
      await vi.waitFor(() => expect(signal).toBeDefined());
      first.release();
      expect(signal!.aborted).toBe(false);
      second.release();
      expect(signal!.aborted).toBe(true);
      expect(store.projections.get('a')).toBeNull();
      finish();
      await refreshing;
      expect(store.scopeState('a')).toBe('unloaded');
      expect(store.projections.get('a')).toBeNull();
      expect(store.get('summary', summaryId('a'))).toBeNull();
    } finally {
      finish();
      first.release();
      second.release();
      store.close();
      await refreshing;
    }
  });

  it('checks a detached result inside its loaded scope, waiting out a dropped connection, without resuming an already saved reply', async () => {
    const { seed, request, key } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('saved'));
    await seed('stream', 'stream', 'a', { key: {}, call: { connection: 'c', source: 'c', model: 'm', modelName: 'm' }, at: 0, result: 'a1', for: { kind: 'reply', message: null, replaces: null, continues: null } });
    let offline = true;
    const flaky: typeof api = (method, path, body, signal) => offline && path.includes('parent=a')
      ? Promise.resolve({ ok: false, error: 'offline' }) : request(method, path, body, signal);
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    const store = await ObjectStore.open('account', key, serverBackend(flaky));
    await store.pull();
    const take = vi.fn();
    const streams = new Streams(store, new Set(), take);
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      streams.pickUp();
      await vi.waitFor(() => expect(store.waiting()).toBe(true));
      expect(store.scopeState('a')).toBe('loading');
      expect(store.get('stream', 'stream')).not.toBeNull();
      offline = false;
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(store.get('stream', 'stream')).toBeNull());
      expect(take).not.toHaveBeenCalled();
      expect(store.scopeState('a')).toBe('unloaded');
    } finally {
      vi.useRealTimers();
      streams.close();
    }
  });

  it('ends a summary write waiting on the server once its chat is let go, though a catch-up ran during it', async () => {
    const { request, key, seed } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('one'));
    let blocked = false;
    let waiting = false;
    const store = await ObjectStore.open('account', key, serverBackend(async (method, path, body, signal) => {
      if (!blocked || method !== 'POST') return request(method, path, body, signal);
      waiting = true;
      return new Promise((resolve) => signal!.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }), { once: true }));
    }));
    await store.pull();
    const lease = store.retainChat('a');
    expect(await lease.ready).toBeNull();
    await seed('a2', 'entry', 'a', message('two'));
    expect(await store.refreshChat('a')).toBeNull();
    blocked = true;
    const saving = store.projections.save('a');
    await vi.waitFor(() => expect(waiting).toBe(true));
    await seed('a3', 'entry', 'a', message('three'));
    expect(await store.refreshChat('a')).toBeNull();
    lease.release();
    expect(await saving).toEqual({ ok: false, error: 'stopped' });
    store.close();
  });

  it.each([false, true])('stops a summary pass at once, its write waiting on the connection, and lets the chat go without throwing (write lands on abort: %s)', async (lands) => {
    const { request, key, seed } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('one'));
    let waiting = false;
    const store = await ObjectStore.open('account', key, serverBackend(async (method, path, body, signal) => {
      if (method !== 'POST') return request(method, path, body, signal);
      waiting = true;
      return new Promise((resolve) => signal!.addEventListener('abort', () => resolve(lands ? request(method, path, body) : { ok: false, error: 'stopped' }), { once: true }));
    }));
    await store.pull();
    const stop = new AbortController();
    const saving = saveSummaries(store, ['a'], stop.signal);
    await vi.waitFor(() => expect(waiting).toBe(true));
    stop.abort();
    expect(await saving).toEqual({ ok: false, error: 'stopped' });
    expect(store.scopeState('a')).toBe('unloaded');
    store.close();
  });

  it('backfills missing summaries by windows of chats held together, in one request each, and does not revisit them', async () => {
    const { seed, open, paths } = await account();
    for (const id of ['a', 'b']) {
      await seed(id, 'chat', null, chat);
      await seed(`${id}1`, 'entry', id, message(id));
    }
    const store = await open();
    const read = new ReadModels(store);
    expect(read.chats.snapshot().every((chat) => chat.count === null)).toBe(true);
    let before = paths.length;
    await backfillSummaries(store, new AbortController().signal);
    expect(paths.slice(before).filter((path) => path === 'objects/batch')).toHaveLength(1);
    expect(store.list('summary')).toHaveLength(2);
    expect(['a', 'b'].map((id) => store.scopeState(id))).toEqual(['unloaded', 'unloaded']);
    before = paths.length;
    await backfillSummaries(store, new AbortController().signal);
    expect(paths.slice(before).some((path) => path.includes('parent='))).toBe(false);
    read.close();
  });

  it('exports every entry through an explicit account walk without filling any chat scope', async () => {
    const { seed, open, request } = await account();
    for (const id of ['a', 'b']) {
      await seed(id, 'chat', null, chat);
      for (let index = 0; index < 3; index++) await seed(`${id}${index}`, 'entry', id, message(`${id}${index}`));
    }
    const store = await open();
    const parts: BlobPart[] = [];
    const exported = await exportBackup(store, new Files(serverBackend(request), store), {
      write: async (bytes) => { parts.push(bytes); }, close: async () => {}, abort: async () => { parts.length = 0; },
    });
    if (!exported.ok) throw new Error(exported.error);
    const backup = await readBackup(new Blob(parts));
    if (!backup.ok) throw new Error(backup.error);
    expect(backup.backup.objects.filter((object) => object.kind === 'entry')).toHaveLength(6);
    expect(store.scopeState('a')).toBe('unloaded');
    expect(store.scopeState('b')).toBe('unloaded');
  });

  it('plans complete owned removals from metadata without loading a closed chat', async () => {
    const { seed, open } = await account();
    await seed('ca', 'character', null, { card: card('Luna'), folder: null, loreFolders: [] });
    await seed('a', 'chat', null, { ...chat, character: 'ca' });
    await seed('a1', 'entry', 'a', message('one'));
    await seed('a2', 'entry', 'a', message('two'));
    await seed('memory', 'memory', 'a', { records: [], chapters: [], state: [], threads: [] });
    const store = await open();
    const decrypt = vi.spyOn(sealedObjects, 'openObject');
    const plan = await store.pinned((pin) => planRemoval(store, { kind: 'character', id: 'ca' }, pin));
    expect(plan.ok && plan.data.map((round) => round.map(({ id }) => id))).toEqual([['a1', 'a2', 'memory'], ['a'], ['ca']]);
    expect(decrypt).not.toHaveBeenCalled();
    expect(store.scopeState('a')).toBe('unloaded');
  });

  it('removes a closed chat and brings it back without loading messages', async () => {
    const { seed, open } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('kept for undo'));
    const store = await open();
    const decrypt = vi.spyOn(sealedObjects, 'openObject');
    const removed = await removeChat(store, 'a');
    if (!removed.ok) throw new Error(removed.error);
    expect(decrypt).not.toHaveBeenCalled();
    expect(store.scopeState('a')).toBe('unloaded');
    expect((await restoreChat(store, 'a')).ok).toBe(true);
    expect(decrypt).not.toHaveBeenCalled();
    expect(store.scopeState('a')).toBe('unloaded');
  });

  it('leaves a deleted chat’s call untaken, and takes it once 되돌리기 brings the chat back', async () => {
    const { seed, open } = await account();
    await seed('a', 'chat', null, chat);
    await seed('stream', 'stream', 'a', { key: {}, call: { connection: 'c', source: 'c', model: 'm', modelName: 'm' }, at: 0, result: 'reply', for: { kind: 'reply', message: null, replaces: null, continues: null } });
    const store = await open();
    await removeChat(store, 'a');
    const take = vi.fn();
    const opened = vi.spyOn(store, 'withChat');
    const streams = new Streams(store, new Set(), take);
    try {
      streams.pickUp();
      expect(opened).not.toHaveBeenCalled();
      await restoreChat(store, 'a');
      streams.pickUp();
      await vi.waitFor(() => expect(take).toHaveBeenCalledOnce());
    } finally { streams.close(); }
  });
});

describe('per-chat read models', () => {
  it("reads a chat's own children again when its scope loads and unloads", async () => {
    const { seed, open } = await account();
    await seed('a', 'chat', null, chat);
    await seed('a1', 'entry', 'a', message('held'));
    const read = new ReadModels(await open());
    const entries = read.children('entry', 'a');
    const heard = vi.fn();
    entries.subscribe(heard);
    expect(entries.snapshot()).toEqual([]);
    const release = await hold(read.store, 'a');
    expect(entries.snapshot().map(({ id }) => id)).toEqual(['a1']);
    release();
    expect(entries.snapshot()).toEqual([]);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('A: a translation or new entry in A never folds or displays B, including pulled writes', async () => {
    const { store, open } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('A'), { id: 'a1', parent: 'a' });
    await store.create('entry', message('B'), { id: 'b1', parent: 'b' });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const b = read.chat('b').snapshot();
    const folders = read.library.snapshot();
    const connectionSnapshot = read.kind('connection').snapshot();
    const personaSnapshot = read.kind('persona').snapshot();
    const bChanged = vi.fn();
    read.chat('b').subscribe(bChanged);
    const folded = vi.spyOn(store, 'foldedChat');
    const displayed = vi.spyOn(store.evaluation, 'display');
    await store.create('entry', { type: 'translation', version: 'a1', text: '번역', receipt: null, at: 1 }, { parent: 'a' });
    const phone = await open();
    await phone.create('entry', message('later'), { parent: 'a' });
    await store.pull();
    expect(folded.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(folded.mock.calls.every(([id]) => id === 'a')).toBe(true);
    expect(displayed.mock.calls.every(([lane]) => lane.chat === 'a')).toBe(true);
    expect(read.chat('b').snapshot()).toBe(b);
    expect(bChanged).not.toHaveBeenCalled();
    expect(read.library.snapshot()).not.toBe(folders);
    expect(read.kind('connection').snapshot()).toBe(connectionSnapshot);
    expect(read.kind('persona').snapshot()).toBe(personaSnapshot);
    expect(read.chat('a').snapshot()?.title).toBe('번역');
    expect(read.chat('a').snapshot()?.preview).toBe('later');
    read.close();
  });

  it('B: character, prompt and persona changes redisplay only their readers and replace recorded dependencies', async () => {
    const { store } = await account();
    for (const id of ['ca', 'cb']) await store.create('character', { card: card(id), folder: null, loreFolders: [] }, { id });
    for (const id of ['pa', 'pb']) await store.create('prompt', { name: id, blocks: [], toggles: [], authorNote: '', models: {} }, { id });
    for (const id of ['ua', 'ub']) await store.create('persona', { name: id, description: '', picture: null }, { id });
    await store.create('chat', { ...chat, character: 'ca', prompt: 'pa', persona: 'ua' }, { id: 'a' });
    await store.create('chat', { ...chat, character: 'cb', prompt: 'pb', persona: 'ub' }, { id: 'b' });
    for (const id of ['a', 'b']) await store.create('entry', message('{{char}} / {{user}} / {{authornote}}'), { parent: id });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const b = read.chat('b').snapshot();
    const folded = vi.spyOn(chatModel.ChatFold.prototype, 'changed');
    const displayed = vi.spyOn(store.evaluation, 'display');
    await store.update('character', 'ca', (current) => ({ ...current, card: { ...current.card, name: 'Luna' } }));
    await store.update('prompt', 'pa', (current) => ({ ...current, authorNote: 'night' }));
    await store.update('persona', 'ua', (current) => ({ ...current, name: 'Mina' }));
    expect(displayed.mock.calls.map(([lane]) => lane.chat)).toEqual(['a', 'a', 'a']);
    expect(folded).not.toHaveBeenCalled();
    expect(read.chat('b').snapshot()).toBe(b);
    expect(read.chat('a').snapshot()?.display.texts).toEqual(['Luna / Mina / night']);
    await store.update('chat', 'a', (current) => ({ ...current, persona: 'missing' }));
    displayed.mockClear();
    await store.update('persona', 'ua', (current) => ({ ...current, name: 'unused' }));
    expect(displayed).not.toHaveBeenCalled();
    await store.create('persona', { name: 'arrived', description: '', picture: null }, { id: 'missing' });
    expect(displayed.mock.calls.map(([lane]) => lane.chat)).toEqual(['a']);
    expect(read.chat('a').snapshot()?.preview).toBe('Luna / arrived / night');
    read.close();
  });

  it('answers a write the server took as done when its chat cannot be evaluated after it, and shows that on the chat', async () => {
    const { store } = await account();
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: chat },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('hello') },
    ]);
    const release = await hold(store, 'a');
    vi.spyOn(store.evaluation, 'display').mockRejectedValueOnce(new EvaluationFailed('crashed'));
    expect(await store.update('chat', 'a', (value) => ({ ...value, note: 'kept' }))).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(store.scopeState('a')).toBe('failed'));
    expect(store.scopeError('a')).toEqual({ ok: false, error: 'evaluation-unavailable' });
    release();
  });

  it('never publishes an evaluated projection whose dependencies changed while the worker was busy', async () => {
    const { store } = await account();
    await store.create('persona', { name: 'first', description: '', picture: null }, { id: 'person' });
    await store.batch([
      { type: 'create', kind: 'chat', id: 'a', parent: null, value: { ...chat, persona: 'person' } },
      { type: 'create', kind: 'entry', id: 'a1', parent: 'a', value: message('{{user}}') },
    ]);
    const release = await hold(store, 'a');
    const read = new ReadModels(store);
    const seen: string[] = [];
    read.chat('a').subscribe(() => { const text = read.chat('a').snapshot()?.display.texts[0]; if (text) seen.push(text); });
    const display = store.evaluation.display.bind(store.evaluation);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    let started = false;
    vi.spyOn(store.evaluation, 'display').mockImplementationOnce(async (...args) => {
      const result = await display(...args);
      started = true;
      await gate;
      return result;
    });
    const old = store.update('persona', 'person', (value) => ({ ...value, name: 'obsolete' }));
    await vi.waitFor(() => expect(started).toBe(true));
    const latest = store.update('persona', 'person', (value) => ({ ...value, name: 'latest' }));
    expect((await latest).ok).toBe(true);
    finish();
    await old;
    await store.projections.evaluate('a');
    expect(seen).toEqual(['latest']);
    await store.projections.save('a');
    expect(read.summary('a').snapshot()?.preview).toBe('latest');
    read.close();
    release();
    store.close();
  });

  it('keeps transient sent messages stable across chunks and resizes only the open chat', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('latest: {{lastmessage}}'), { parent: 'a' });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const talk = liveTalk();
    const opening = { chat, messages: [] };
    const screen = read.screen('a', talk, NO_DRAWINGS, opening, plainDisplay(store));
    const leave = screen.subscribe(() => {});
    await hold(store, screen.id);
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot().pending).not.toBe(true));
    const displayed = vi.spyOn(store.evaluation, 'display');
    const first = screen.snapshot();
    // A composer or panel render has new wrapper objects, not new display inputs.
    screen.setInputs({ ...opening }, { width: 800, height: 600 });
    expect(screen.snapshot()).toBe(first);
    expect(screen.snapshot()).toBe(first);
    expect(displayed).not.toHaveBeenCalled();
    const turn: Turn = { chat: 'a', said: { id: 'said', text: 'question' }, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'one', reasoning: '' };
    talk.set(turn);
    await vi.waitFor(() => expect(screen.snapshot().display.texts[0]).toBe('latest: one'));
    const chunk = screen.snapshot();
    talk.set({ ...turn, text: 'one two' });
    await vi.waitFor(() => expect(screen.snapshot().display.texts[0]).toBe('latest: one two'));
    const next = screen.snapshot();
    expect(displayed.mock.calls.map(([lane]) => lane.chat)).toEqual(['a', 'a']);
    expect(next.display.texts[0]).toBe('latest: one two');
    expect(next.messages[0]).toBe(chunk.messages[0]);
    expect(next.messages[1]).toBe(chunk.messages[1]);
    expect(next.messages[2]).not.toBe(chunk.messages[2]);
    screen.setInputs({ ...opening }, { width: 800, height: 600 });
    expect(screen.snapshot()).toBe(next);
    expect(displayed).toHaveBeenCalledTimes(2);
    const b = read.chat('b').snapshot();
    screen.setInputs(opening, { width: 900, height: 600 });
    expect(displayed.mock.calls.map(([lane]) => lane.chat)).toEqual(['a', 'a', 'a']);
    expect(read.chat('b').snapshot()).toBe(b);
    leave();
    read.close();
  });

  it('shows a reply as it streams when each pass is slower than the chunks, and ends on the last chunk', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await hold(store, 'a');
    const read = new ReadModels(store);
    const open = plainDisplay(store);
    const talk = liveTalk();
    const opening = { chat, messages: [] };
    const screen = read.screen('a', talk, NO_DRAWINGS, opening, open);
    const display = open.display.bind(open);
    const passes: Promise<unknown>[] = [];
    vi.spyOn(open, 'display').mockImplementation((...args) => {
      const pass = new Promise<void>((resolve) => setTimeout(resolve, 30)).then(() => display(...args));
      passes.push(pass);
      return pass;
    });
    const replies: string[] = [];
    const leave = screen.subscribe(() => replies.push(screen.snapshot().display.texts[1] ?? ''));
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot().pending).not.toBe(true));
    const turn: Turn = { chat: 'a', said: { id: 'said', text: 'q' }, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: '', reasoning: '' };
    for (let chunk = 1; chunk <= 12; chunk++) {
      talk.set({ ...turn, text: 'x'.repeat(chunk) });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await vi.waitFor(() => expect(screen.snapshot().display.texts[1]).toBe('x'.repeat(12)));
    expect(replies.filter((text) => text.length > 0 && text.length < 12).length).toBeGreaterThan(1);
    expect(passes.length).toBeLessThan(12);
    leave();
    read.close();
  });

  it('keeps a saved reply on screen when its turn ends before the projection follows the save', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('entry', message('q'), { id: 'said', parent: 'a' });
    await hold(store, 'a');
    const read = new ReadModels(store);
    const talk = liveTalk();
    const opening = { chat, messages: [] };
    const screen = read.screen('a', talk, NO_DRAWINGS, opening, plainDisplay(store));
    const shown: string[][] = [];
    const leave = screen.subscribe(() => shown.push(screen.snapshot().messages.map((each) => each.id)));
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot().pending).not.toBe(true));
    talk.set({ chat: 'a', said: null, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'hello', reasoning: '' });
    await vi.waitFor(() => expect(screen.snapshot().messages.map((each) => each.id)).toEqual(['said', 'reply']));
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    const display = store.evaluation.display.bind(store.evaluation);
    vi.spyOn(store.evaluation, 'display').mockImplementation(async (lane, ...rest) => {
      if (lane.asker === 'projection') await held;
      return display(lane, ...rest);
    });
    await store.create('entry', { ...message('hello'), role: 'assistant' }, { id: 'reply', parent: 'a' });
    talk.set(null);
    await vi.waitFor(() => expect(screen.snapshot().messages[1]?.live).toBeNull());
    release();
    expect(shown.every((ids) => ids.length < 2 || ids.includes('reply'))).toBe(true);
    leave();
    read.close();
  });

  it('shows a screen left and opened again while its first pass ran', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('entry', message('hi'), { parent: 'a' });
    await hold(store, 'a');
    const read = new ReadModels(store);
    const opening = { chat, messages: [] };
    const screen = read.screen('a', liveTalk(), NO_DRAWINGS, opening, plainDisplay(store));
    screen.setInputs(opening, { width: 800, height: 600 });
    screen.subscribe(() => {})();
    const leave = screen.subscribe(() => {});
    await vi.waitFor(() => expect(screen.snapshot().display.texts).toEqual(['hi']));
    leave();
    read.close();
  });

  it('keeps a shown display through a failed one, and stays pending when none was shown', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('entry', message('hi'), { parent: 'a' });
    await hold(store, 'a');
    const read = new ReadModels(store);
    const open = plainDisplay(store);
    const opening = { chat, messages: [] };
    const screen = read.screen('a', liveTalk(), NO_DRAWINGS, opening, open);
    const failing = vi.spyOn(open, 'display').mockRejectedValue(new Error('crash'));
    const leave = screen.subscribe(() => {});
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot().error).toBeInstanceOf(Error));
    expect(screen.snapshot()).toMatchObject({ pending: true, messages: [] });
    failing.mockRestore();
    await screen.refresh();
    const shown = screen.snapshot();
    expect(shown.pending).toBeUndefined();
    expect(shown.error).toBeUndefined();
    expect(shown.messages).toHaveLength(1);
    vi.spyOn(open, 'display').mockRejectedValueOnce(new Error('again'));
    await screen.refresh();
    expect(screen.snapshot()).toEqual({ ...shown, error: new Error('again') });
    leave();
    read.close();
  });

  it("shows a chat not saved yet whose display stuck without the bot's regex, and with it again once 다시 시도 clears that", async () => {
    const { store } = await account();
    const read = new ReadModels(store);
    const open = plainDisplay(store);
    const opening = { chat, messages: [] };
    const screen = read.screen('n', liveTalk(), NO_DRAWINGS, opening, open);
    const display = open.display.bind(open);
    let stalled = false;
    const displayed = vi.spyOn(open, 'display').mockImplementation(async (...args) => {
      if (stalled || !args[3]) return display(...args);
      stalled = true;
      throw new EvaluationStuck('stuck', true);
    });
    const leave = screen.subscribe(() => {});
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot()).toMatchObject({ stuck: true }));
    expect(screen.snapshot().error).toBeUndefined();
    expect(displayed).toHaveBeenCalledTimes(3);
    screen.retryRegex();
    await vi.waitFor(() => expect(screen.snapshot()).toMatchObject({ stuck: false }));
    leave();
    read.close();
  });

  it('emits kind/id/parent for batch, remove, restore and paginated pull, and ignores stale echoes', async () => {
    const { store, open } = await account();
    const observed: StoreChange[][] = [];
    store.subscribe((changes) => {
      const objects = changes.filter((change) => change.kind === 'chat' || change.kind === 'entry');
      if (objects.length) observed.push(objects);
    });
    await hold(store, 'c');
    await store.batch([
      { type: 'create', kind: 'chat', id: 'c', parent: null, value: chat },
      { type: 'create', kind: 'entry', id: 'e', parent: 'c', value: message('hi') },
    ]);
    const both = [{ kind: 'entry', id: 'e', parent: 'c' }, { kind: 'chat', id: 'c', parent: null }];
    expect(observed).toEqual([both, both]);
    const entry = store.get('entry', 'e')!;
    await store.pull();
    expect(observed).toHaveLength(2);
    await store.remove('e');
    await store.restore(entry);
    expect(observed.slice(2)).toEqual(Array(4).fill([{ kind: 'entry', id: 'e', parent: 'c' }]));
    const phone = await open();
    for (let index = 0; index < 3; index++) await phone.create('entry', message('remote'), { id: `r${index}`, parent: 'c' });
    observed.length = 0;
    await store.pull();
    expect(observed.flat()).toEqual([0, 1, 2].map((index) => ({ kind: 'entry', id: `r${index}`, parent: 'c' })));
  });

  it('serves unsaved greetings and a first live turn while the same id becomes stored', async () => {
    const { store } = await account();
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    const talk = liveTalk();
    const greeting: chatModel.Message = { id: 'opening', role: 'assistant', at: 0, versions: [{ id: 'g', seed: 'g', text: '{{screenwidth}}', receipt: null, edited: false, at: 0 }], selected: 0 };
    const opening = { chat, messages: [greeting] };
    const screen = read.screen('new', talk, NO_DRAWINGS, opening, plainDisplay(store));
    const leave = screen.subscribe(() => {});
    await hold(store, screen.id);
    screen.setInputs(opening, { width: 800, height: 600 });
    await vi.waitFor(() => expect(screen.snapshot().display.texts).toEqual(['800']));
    expect(await read.displayed('new')).toBeNull();
    talk.set({ chat: 'new', said: { id: 'said', text: 'hi' }, reply: { id: 'reply', message: null, replaces: null, continues: null }, text: 'hello', reasoning: '' });
    await vi.waitFor(() => expect(screen.snapshot().messages.map((message) => message.id)).toEqual(['opening', 'said', 'reply']));
    await store.batch([
      { type: 'create', kind: 'entry', id: 'g', parent: 'new', value: { ...message('{{screenwidth}}'), role: 'assistant' } },
      { type: 'create', kind: 'chat', id: 'new', parent: null, value: chat },
    ]);
    await vi.waitFor(() => expect(screen.snapshot().messages.map((message) => message.id)).toEqual(['g', 'said', 'reply']));
    expect(screen.snapshot().display.texts).toEqual(['800', 'hi', 'hello']);
    expect((await read.displayed('new'))?.display.texts).toEqual(['{{screenwidth}}']);
    leave();
    read.close();
  });

  it('lists a kind by name, so an edited one keeps its place', async () => {
    const { store } = await account();
    for (const name of ['나', '가', '다']) await store.create('persona', { name, description: '', picture: null }, { id: name });
    const read = new ReadModels(store);
    const names = () => read.kind('persona').snapshot().map(({ value }) => value.name);
    expect(names()).toEqual(['가', '나', '다']);
    await store.update('persona', '가', (current) => ({ ...current, alias: '별명' }));
    expect(names()).toEqual(['가', '나', '다']);
    read.close();
  });

  it('keeps populated chat order on rename and unchanged summaries on dependency writes', async () => {
    const { store } = await account();
    await store.create('chat', chat, { id: 'a' });
    await store.create('chat', chat, { id: 'b' });
    await store.create('entry', message('a first'), { id: 'a1', parent: 'a' });
    await hold(store, ...store.list('chat').map(({ id }) => id));
    const read = new ReadModels(store);
    await store.update('chat', 'b', (current) => ({ ...current, title: 'renamed' }));
    await vi.waitFor(() => expect(read.chats.snapshot().map(({ id }) => id)).toEqual(['b', 'a']));
    // Empty chats use their own rev; once entries exist, only entries determine their recency.
    await store.create('entry', message('b first'), { id: 'b1', parent: 'b' });
    const messages = read.chat('a').snapshot()?.messages;
    await store.update('chat', 'a', (current) => ({ ...current, title: 'A' }));
    expect(read.chats.snapshot().map(({ id }) => id)).toEqual(['b', 'a']);
    expect(read.chat('a').snapshot()?.messages).toBe(messages);
    await store.projections.save('a');
    await store.projections.save('b');
    const summaries = read.chats.snapshot();
    const library = read.library.snapshot();
    await store.upsert('settings', () => ({ models: {} }));
    expect(read.chats.snapshot()).toBe(summaries);
    expect(read.library.snapshot()).toBe(library);
    expect(read.chat('a').snapshot()?.messages).toBe(messages);
    read.close();
  });

  it('reads a deleted chat as gone from its character, the chat list and its screen, and 되돌리기 brings it back whole', async () => {
    const { store } = await account();
    await store.create('character', { card: card('루나'), folder: null, loreFolders: [] }, { id: 'ca' });
    await store.create('chat', { ...chat, character: 'ca' }, { id: 'a' });
    await store.create('chat', { ...chat, character: 'ca' }, { id: 'b' });
    await store.create('entry', message('a first'), { id: 'a1', parent: 'a' });
    await hold(store, 'a', 'b');
    const read = new ReadModels(store);
    const lists = () => [read.chats.snapshot(), read.library.snapshot().characters[0]!.chats].map((list) => list.map(({ id }) => id).toSorted());
    const texts = () => read.chat('a').snapshot()?.messages.map((message) => chatModel.shown(message).text);
    expect([lists(), texts()]).toEqual([[['a', 'b'], ['a', 'b']], ['a first']]);

    await removeChat(store, 'a');
    expect([lists(), read.summary('a').snapshot(), read.chat('a').snapshot()]).toEqual([[['b'], ['b']], null, null]);
    await restoreChat(store, 'a');
    expect([lists(), texts(), read.summary('a').snapshot()?.count]).toEqual([[['a', 'b'], ['a', 'b']], ['a first'], 1]);
    read.close();
  });

  it('lists in 휴지통 the deleted chats of a character not deleted or of none, never those of a deleted character', async () => {
    const { store } = await account();
    await store.create('character', { card: card('루나'), folder: null, loreFolders: [] }, { id: 'ca' });
    await store.create('character', { card: card('해나'), folder: null, loreFolders: [], deleted: Date.now() }, { id: 'cd' });
    await store.create('chat', { ...chat, character: 'ca', title: '등대' }, { id: 'a' });
    await store.create('chat', { ...chat, character: 'cd' }, { id: 'd' });
    await store.create('chat', chat, { id: 'n' });
    const read = new ReadModels(store);
    const binned = () => read.library.snapshot().deletedChats.map(({ id, title }) => [id, title]).toSorted();
    for (const id of ['a', 'd', 'n']) await removeChat(store, id);
    expect([binned(), read.chats.snapshot(), read.summary('a').snapshot()]).toEqual([[['a', '등대'], ['n', expect.any(String)]], [], null]);

    await restoreChat(store, 'a');
    expect([binned(), read.chats.snapshot().map(({ id }) => id)]).toEqual([[['n', expect.any(String)]], ['a']]);
    read.close();
  });
});
