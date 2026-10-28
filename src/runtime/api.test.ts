import { afterEach, expect, it, vi } from 'vitest';
import { api, fetchApi, hearServedVersion, holdAccount, holdPulse, markSeen, SLOW_ROUTE_WAIT } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  holdAccount(null);
  holdPulse(false);
});

it('labels a call and owes the page-load mark to the next request only while the account shares', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({}));
  vi.stubGlobal('fetch', fetch);
  const call = { kind: 'call', role: 'chat', type: 'direct', model: 'glm 5.2' } as const;
  holdPulse(true);
  markSeen();
  await fetchApi('objects');
  await fetchApi('objects');
  await fetchApi('relay', { pulse: call });
  holdPulse(false);
  markSeen();
  await fetchApi('relay', { pulse: call });
  await fetchApi('objects');
  holdPulse(true);
  await fetchApi('objects');
  expect(fetch.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['x-hazelle-pulse'])).toEqual(['seen', undefined, 'chat direct glm%205.2', undefined, undefined, 'seen']);
});

it('reads a connection that drops inside the answer or a 5xx page the proxy wrote as offline, and another answer that is not JSON as a server error with its status', async () => {
  const dropped = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      controller.enqueue(new TextEncoder().encode('{"revs":'));
      controller.error(new TypeError('network error'));
    },
  });
  vi.stubGlobal('fetch', async () => new Response(dropped));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'offline' });

  vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'offline' });

  vi.stubGlobal('fetch', async () => new Response('<html>403</html>', { status: 403 }));
  expect(await api('POST', 'objects/batch', {})).toEqual({ ok: false, error: 'server-error', status: 403 });
});

it('states the account the page holds with every request, and hears what answers say of the account', async () => {
  const answers = [
    Response.json({ error: 'suspended' }, { status: 403, headers: { 'x-relay': 'upstream' } }),
    Response.json({ error: 'suspended' }, { status: 403 }),
    Response.json({ error: 'storage-full' }, { status: 413 }),
    Response.json({ revs: [1] }, { headers: { 'x-account-bytes': '120' } }),
    new Response(null, { status: 204, headers: { 'x-account-file-bytes': '30', 'x-unread-notices': '2' } }),
    Response.json({ error: 'account-mismatch' }, { status: 409 }),
    Response.json({ error: 'account-mismatch' }, { status: 409 }),
  ];
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => answers.shift()!);
  vi.stubGlobal('fetch', fetch);
  const heard = vi.fn();
  holdAccount('account-a', heard);

  for (let sent = 0; sent < 7; sent++) await api('POST', 'objects/batch', {});
  expect(fetch.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['x-account'])).toEqual(Array(7).fill('account-a'));
  expect(heard.mock.calls.map(([told]) => told)).toEqual([
    { kind: 'suspended' },
    { kind: 'storage-full' },
    { kind: 'bytes', bytes: 120 },
    { kind: 'file-bytes', fileBytes: 30 },
    { kind: 'notices', unread: 2 },
    { kind: 'elsewhere' },
  ]);
});

it('tells each release the server says it runs once, not one an immutable answer carries, and a listener that comes later the last one said', async () => {
  const answers = ['v1', 'v1', null, 'v2'].map((version) => Response.json({}, { headers: version ? { 'x-hazelle-version': version } : {} }));
  answers.splice(2, 0, Response.json({}, { headers: { 'x-hazelle-version': 'v0', 'cache-control': 'private, max-age=31536000, immutable' } }));
  vi.stubGlobal('fetch', async () => answers.shift()!);
  const heard = vi.fn();
  hearServedVersion(heard);
  for (let sent = 0; sent < 5; sent++) await api('GET', 'session');
  expect(heard.mock.calls).toEqual([['v1'], ['v2']]);

  const later = vi.fn();
  hearServedVersion(later);
  expect(later.mock.calls).toEqual([['v2']]);
  hearServedVersion(null);
});

it('gives up on headers that never come as offline, so the store waits for the connection instead', async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const answer = api('POST', 'objects/batch', {});
    const slow = api('DELETE', 'account', {}, undefined, SLOW_ROUTE_WAIT);
    let slowEnded = false;
    void slow.then(() => (slowEnded = true));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await answer).toEqual({ ok: false, error: 'offline' });
    expect(slowEnded).toBe(false);
    await vi.advanceTimersByTimeAsync(SLOW_ROUTE_WAIT);
    expect(await slow).toEqual({ ok: false, error: 'offline' });
  } finally {
    vi.useRealTimers();
  }
});

it('does not deliver a previous account’s late headers or refusal to the new account', async () => {
  let resolve!: (response: Response) => void;
  const pending = new Promise<Response>((done) => { resolve = done; });
  vi.stubGlobal('fetch', () => pending);
  holdAccount('a', vi.fn());
  const answer = fetchApi('objects');
  const heard = vi.fn();
  holdAccount('b', heard);
  resolve(Response.json({ error: 'account-mismatch' }, { status: 409, headers: { 'x-account-bytes': '123', 'x-account-file-bytes': '45', 'x-unread-notices': '2', 'x-unread-board': '3' } }));
  await answer;
  expect(heard).not.toHaveBeenCalled();
  vi.stubGlobal('fetch', async () => Response.json({}, { headers: { 'x-account-bytes': '7' } }));
  await fetchApi('objects');
  expect(heard).toHaveBeenCalledExactlyOnceWith({ kind: 'bytes', bytes: 7 });
});

it('does not apply a refusal if the session changes while its body is read', async () => {
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream({ start: (controller) => { body = controller; } }), { status: 409 });
  const reading = vi.spyOn(response, 'clone');
  vi.stubGlobal('fetch', async () => response);
  const old = vi.fn();
  holdAccount('a', old);
  const answer = fetchApi('objects');
  await vi.waitFor(() => expect(reading).toHaveBeenCalled());
  const current = vi.fn();
  holdAccount('a', current);
  body.enqueue(new TextEncoder().encode('{"error":"account-mismatch"}'));
  body.close();
  await answer;
  expect(old).not.toHaveBeenCalled();
  vi.stubGlobal('fetch', async () => Response.json({}, { headers: { 'x-account-bytes': '7' } }));
  await fetchApi('objects');
  expect(current).toHaveBeenCalledExactlyOnceWith({ kind: 'bytes', bytes: 7 });
});

it('allows a progressing body past the header wait but cancels a stalled one', async () => {
  vi.useFakeTimers();
  try {
    let body!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({ start: (controller) => { body = controller; }, cancel })));
    const answer = api('GET', 'objects');
    let ended = false;
    void answer.then(() => { ended = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    body.enqueue(new Uint8Array([1]));
    await vi.advanceTimersByTimeAsync(10_000);
    body.enqueue(new Uint8Array([2]));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await answer).toEqual({ ok: false, error: 'offline' });
    expect(cancel).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); }
});
