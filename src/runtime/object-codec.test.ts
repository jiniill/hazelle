import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverBackend } from './backend';
import type { Connection } from '../connectors/types';
import { randomBytes } from '../vault/aead';
import { objectKey, openObject } from '../vault/objects';
import type { api, ApiResult } from './api';
import { CodecAborted, CodecUnavailable, ObjectCodec, OPEN_BYTES, OPEN_ITEMS, SEAL_ITEMS } from './object-codec';
import { codeObjects, codecValue, type CodecJob, type CodecResult, type CodecDown, type CodecUp } from './object-codec-core';
import type { DeviceCache } from './object-cache';
import { ObjectStore } from './store';
import type { Write } from './object-writes';
import { CodecWorker } from './testing/object-codec-setup';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const signal = () => new AbortController().signal;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const key = () => objectKey(randomBytes(32));
const item = { id: 'one', kind: 'connection', parent: null };
function scripted(run: (job: CodecJob) => Promise<CodecResult[]>) {
  const made: CodecWorker[] = [];
  vi.stubGlobal('Worker', class extends CodecWorker {
    constructor() { super(); made.push(this); }
    override run(job: CodecJob) { return run(job); }
  });
  return made;
}

describe('persistent object codec', () => {
  it('keeps the vault wire format, ordered item errors and oversized-body suppression', async () => {
    const secret = await key();
    const values = [{ ...item, value: { label: '첫째' } }, { ...item, id: 'two', value: { label: '둘째' } }];
    const sealed = await codeObjects(secret, 'account', { kind: 'seal', items: values, limit: 10000 });
    const bodies = sealed.map((result) => codecValue(result) as string);
    expect(await openObject(secret, 'account', item, bodies[0]!)).toEqual(values[0]!.value);
    const opened = await codeObjects(secret, 'account', { kind: 'open', items: [
      { ...item, body: bodies[0]! }, { ...item, body: 'not base64!' }, { ...item, id: 'two', body: bodies[1]! },
    ] });
    expect(opened[0]).toEqual({ ok: true, value: values[0]!.value });
    expect(opened[1]?.ok).toBe(false);
    expect(() => codecValue(opened[1]!)).toThrow();
    expect(opened[2]).toEqual({ ok: true, value: values[1]!.value });
    expect(await codeObjects(secret, 'account', { kind: 'seal', items: values, limit: 1 })).toEqual([{ ok: true, value: null }, { ok: true, value: null }]);
  });

  it('cancels queued and active callers promptly without admitting work past the active bounded batch', async () => {
    const first = deferred<CodecResult[]>();
    const next = deferred<CodecResult[]>();
    const run = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const made = scripted(run);
    const codec = new ObjectCodec('account', await key(), 1);
    const active = new AbortController();
    const queued = new AbortController();
    const one = codec.open([{ ...item, body: 'first' }], active.signal);
    const two = codec.open([{ ...item, body: 'cancelled' }], queued.signal);
    const three = codec.open([{ ...item, body: 'last' }], signal());
    const rejected = [expect(one).rejects.toBeInstanceOf(CodecAborted), expect(two).rejects.toBeInstanceOf(CodecAborted)];
    await Promise.resolve();
    active.abort();
    queued.abort();
    await Promise.all(rejected);
    expect(run).toHaveBeenCalledTimes(1);
    first.resolve([{ ok: true, value: 'obsolete' }]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]?.[0].items[0].body).toBe('last');
    next.resolve([{ ok: true, value: 'kept' }]);
    expect(await three).toEqual([{ ok: true, value: 'kept' }]);
    const terminate = vi.spyOn(made[0]!, 'terminate');
    codec.close();
    await expect(codec.open([], signal())).rejects.toBeInstanceOf(CodecAborted);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('initializes every pool worker with its key once, spreads jobs, and ends the pool when one worker crashes', async () => {
    const made: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((event: { data: CodecUp }) => void) | null = null;
      onerror: (() => void) | null = null;
      onmessageerror: (() => void) | null = null;
      postMessage = vi.fn<(message: CodecDown) => void>();
      terminate = vi.fn();
      constructor() { made.push(this); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const secret = await key();
    const codec = new ObjectCodec('account', secret);
    expect(codec.workers).toBe(2);
    const first = codec.open([{ ...item, body: 'first' }], signal());
    const second = codec.open([{ ...item, body: 'second' }], signal());
    await vi.waitFor(() => expect(made).toHaveLength(2));
    for (const worker of made) {
      await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2));
      expect(worker.postMessage.mock.calls[0]![0]).toEqual({ kind: 'init', account: 'account', key: secret });
      expect(worker.postMessage.mock.calls[1]![0]).toMatchObject({ kind: 'batch' });
    }
    made[0]!.onmessage!({ data: { id: 1, results: [{ ok: true, value: 'opened' }] } });
    expect(await first).toEqual([{ ok: true, value: 'opened' }]);
    const crashed = expect(second).rejects.toBeInstanceOf(CodecUnavailable);
    made[1]!.onerror!();
    await crashed;
    expect(made.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true);
    await expect(codec.open([{ ...item, body: 'third' }], signal())).rejects.toBeInstanceOf(CodecUnavailable);
    codec.close();
  });
});

// Deliberately large feed pages exercise codec bounds independently of a server's current page size.
function feed(bodies: string[], limits = { items: 200, bytes: 10000000, body: 1000000 }) {
  let rev = bodies.length;
  const rows = bodies.map((body, index) => ({ id: String(index), kind: 'connection', parent: null, rev: index + 1, body }));
  const writes: { id: string; body: string | null }[][] = [];
  const request: typeof api = async <T,>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> => {
    if (method === 'POST') {
      const batch = (body as { writes: typeof writes[number] }).writes;
      writes.push(batch);
      return { ok: true, data: { revs: batch.map(() => ++rev) } as T };
    }
    const since = Number(new URLSearchParams(path.split('?')[1]).get('since'));
    return { ok: true, data: { timeline: 'one', until: rev, changes: since ? [] : rows, cursor: rev, more: false, limits } as T };
  };
  return { request, writes };
}

describe('object codec store boundaries', () => {
  it('opens full item/byte bounded windows in order and holds a scan to its dispatch-ahead bound', async () => {
    const jobs: CodecJob[] = [];
    scripted(async (job) => {
      jobs.push(job);
      return job.items.map(({ id }) => ({ ok: true, value: { label: id } }));
    });
    const { request } = feed(Array.from({ length: 150 }, () => 'a'.repeat(100000)));
    const store = await ObjectStore.open('account', randomBytes(32), serverBackend(request));
    expect(await store.pull()).toBeNull();
    expect(jobs.map(({ items }) => items.length)).toEqual([41, 41, 41, 27]);
    expect(jobs.every((job) => job.kind === 'open' && job.items.length <= OPEN_ITEMS && job.items.reduce((bytes, row) => bytes + row.body.length, 0) <= OPEN_BYTES)).toBe(true);
    expect(store.list('connection').map(({ id }) => id)).toEqual(Array.from({ length: 150 }, (_, index) => String(index)));
    jobs.length = 0;
    const pin = await store.pin();
    if (!pin.ok) throw new Error(pin.error);
    const wait = deferred<void>();
    const visit = vi.fn(async () => { await wait.promise; });
    const scan = store.scan({}, visit, pin.data);
    await vi.waitFor(() => expect(visit).toHaveBeenCalledOnce());
    expect(jobs).toHaveLength(3);
    wait.resolve();
    expect(await scan).toBeNull();
    expect(visit).toHaveBeenCalledTimes(150);
    expect(jobs).toHaveLength(4);
    store.close();
  });

  it('marks malformed objects unreadable in pull but propagates the same error during backup scan', async () => {
    const { request } = feed(['not base64!']);
    const store = await ObjectStore.open('account', randomBytes(32), serverBackend(request));
    expect(await store.pull()).toBeNull();
    expect(store.unreadable()).toBe(1);
    const pin = await store.pin();
    if (!pin.ok) throw new Error(pin.error);
    await expect(store.scan({}, () => {}, pin.data)).rejects.toThrow();
    store.close();
  });

  it('does not turn transport failures into unreadable objects or successful scans', async () => {
    scripted(async () => { throw new Error('crashed'); });
    const { request } = feed(['body']);
    const store = await ObjectStore.open('account', randomBytes(32), serverBackend(request));
    expect(await store.pull()).toEqual({ ok: false, error: 'codec-unavailable' });
    expect(store.unreadable()).toBe(0);
    expect(store.list('connection')).toEqual([]);
    store.close();
  });

  it('keeps an encrypted cache intact when its worker fails during opening', async () => {
    scripted(async () => { throw new Error('crashed'); });
    const generation = { id: 'device', timeline: 'one' };
    const cache: DeviceCache = {
      open: async () => ({ generation, saved: {
        state: { cursor: 1, complete: true, until: null, limits: { items: 200, bytes: 10000000, body: 1000000 }, heads: [], revisions: [] },
        changes: [{ ...item, rev: 1, body: 'ciphertext' }],
      } }),
      read: vi.fn(async () => null), scopes: vi.fn(async () => new Map()), write: vi.fn(async () => {}), clear: vi.fn(async () => generation),
      adopt: vi.fn(async () => generation), forget: vi.fn(async () => {}),
    };
    const { request } = feed([]);
    const store = await ObjectStore.open('account', randomBytes(32), serverBackend(request), cache);
    expect(store.cached).toBe(false);
    expect(await store.pull()).toEqual({ ok: false, error: 'codec-unavailable' });
    expect(store.unreadable()).toBe(0);
    expect(cache.clear).not.toHaveBeenCalled();
    expect(cache.write).not.toHaveBeenCalled();
    expect(cache.adopt).not.toHaveBeenCalled();
    store.close();
  });

  it('lands a byte-limited prefix before consuming a future seal failure and keeps no-op progress slots', async () => {
    const jobs: CodecJob[] = [];
    scripted(async (job) => {
      jobs.push(job);
      return job.items.map(({ id }) => id === 'broken' ? { ok: false, name: 'Error', message: 'future error' } : { ok: true, value: 'x'.repeat(120) });
    });
    const { request, writes } = feed([], { items: 200, bytes: 250, body: 1000 });
    const store = await ObjectStore.open('account', randomBytes(32), serverBackend(request));
    const value: Connection = { type: 'openrouter', label: 'a', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] };
    const first = await store.create('connection', { ...value, starred: [] }, { id: 'one' });
    expect(first.ok).toBe(true);
    writes.length = 0;
    const batch = ['one', 'two', 'three', 'broken'].map((id): Write => ({ type: 'create', kind: 'connection', id, parent: null, value: { ...value, starred: [] } }));
    const progress = vi.fn<(write: Write) => void>();
    await expect(store.batch(batch, progress)).rejects.toThrow('future error');
    expect(writes.map((part) => part.map(({ id }) => id))).toEqual([['two']]);
    expect(progress.mock.calls.map(([write]) => write.id)).toEqual(['one', 'two']);
    expect(jobs.every(({ items }) => items.length <= SEAL_ITEMS)).toBe(true);
    store.close();
  });
});
