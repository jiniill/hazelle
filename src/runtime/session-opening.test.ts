import { afterEach, expect, it, vi } from 'vitest';
import { serverBackend } from './backend';
import { randomBytes } from '../vault/aead';
import type { CodecJob } from './object-codec-core';
import type { api, ApiResult } from './api';
import { openSession } from './session';
import { ObjectStore, type PullProgress } from './store';
import { CodecWorker } from './testing/object-codec-setup';

afterEach(() => vi.unstubAllGlobals());

it('reports received objects and pages during opening and aborts the in-flight initial pull without starting a session', async () => {
  const abandon = new AbortController();
  const progress: PullProgress[] = [];
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    url = url.replace(/&known=\d+|&timeline=t$/g, '');
    if (url === '/api/objects?since=3&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1') {
      started();
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    }
    const revs = url === '/api/objects?since=0&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1&count=1' ? [1, 2] : [3];
    return Response.json({
      timeline: 't',
      changes: revs.map((rev) => ({ id: `gone-${rev}`, kind: 'connection', parent: null, rev, body: null })),
      cursor: revs.at(-1),
      more: true,
      limits: { items: 100, bytes: 1_000_000, body: 100_000 },
    });
  });
  vi.stubGlobal('fetch', fetch);
  const opening = openSession('account', randomBytes(32), 'jin', abandon.signal, (next) => progress.push(next));
  await waiting;
  expect(progress).toEqual([{ objects: 2, pages: 1, waiting: false }, { objects: 3, pages: 2, waiting: false }]);
  abandon.abort();
  expect(await opening).toEqual({ ok: false, error: 'stopped' });
  expect(fetch.mock.calls.map(([url]) => url.replace(/&known=\d+|&timeline=t$/g, ''))).toEqual(['/api/objects?since=0&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1&count=1', '/api/objects?since=2&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1', '/api/objects?since=3&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1']);
});

it('requests the next page while the current one is still being opened, across the bootstrap transition', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  vi.stubGlobal('Worker', class extends CodecWorker {
    override async run(job: CodecJob) {
      await held;
      return job.items.map(() => ({ ok: true as const, value: { label: 'opened' } }));
    }
  });
  const asked: string[] = [];
  const request: typeof api = async <T,>(_method: string, path: string): Promise<ApiResult<T>> => {
    asked.push(path.replace(/&known=\d+|&timeline=t$/g, ''));
    const bootstrap = asked.at(-1) === 'objects?since=0&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1&count=1';
    return { ok: true, data: {
      timeline: 't',
      changes: bootstrap ? [1, 2].map((rev) => ({ id: `c${rev}`, kind: 'connection', parent: null, rev, body: 'sealed' })) : [],
      cursor: 2,
      more: false,
      limits: { items: 100, bytes: 1_000_000, body: 100_000 },
      ...(bootstrap ? { until: 2 } : {}),
    } as T };
  };
  const store = await ObjectStore.open('account', randomBytes(32), serverBackend(request));
  const pulling = store.pull();
  await vi.waitFor(() => expect(asked).toHaveLength(2));
  expect(asked).toEqual(['objects?since=0&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger&bootstrap=1&count=1', 'objects?since=2&exclude=entry,memory,illustration,inlay,textfile,toolchat,cacheprint,remark,ledger']);
  expect(store.list('connection')).toEqual([]);
  release();
  expect(await pulling).toBeNull();
  expect(store.list('connection').map(({ id }) => id)).toEqual(['c1', 'c2']);
  store.close();
});
