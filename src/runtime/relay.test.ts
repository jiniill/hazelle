import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HttpRequest } from '../connectors/types';
import { streamKey } from '../vault/streams';
import { holdAccount, holdPulse } from './api';
import { directTransport, dropStream, relay, relayJson, stopStream, stream } from './relay';

const request: HttpRequest = { url: 'https://example.com/models', method: 'GET', headers: {}, body: null };
const broken = () => new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('network error')) }), { headers: { 'x-relay': 'upstream' } });

afterEach(() => {
  vi.unstubAllGlobals();
  holdAccount(null);
  holdPulse(false);
});

describe('relayJson', () => {
  it('answers a body that breaks while it is read as offline, or stopped when the signal stopped it', async () => {
    vi.stubGlobal('fetch', async () => broken());
    expect(await relayJson(request)).toEqual({ ok: false, failure: { kind: 'offline' } });

    const abort = new AbortController();
    vi.stubGlobal('fetch', async () => {
      abort.abort();
      return broken();
    });
    expect(await relayJson(request, abort.signal)).toEqual({ ok: false, failure: { kind: 'stopped' } });
  });
});

it('ends a read at once when it is stopped while it cannot reach the server', async () => {
  const abort = new AbortController();
  vi.stubGlobal('fetch', async () => {
    abort.abort();
    throw new TypeError('Failed to fetch');
  });
  const began = Date.now();
  expect(await stream({ id: crypto.randomUUID(), key: {} }, null, abort.signal)).toEqual({ kind: 'stopped' });
  expect(Date.now() - began).toBeLessThan(500);
});

it('ends a read once the session is gone instead of trying again', async () => {
  const fetch = vi.fn(async () => Response.json({ error: 'no-session' }, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  expect(await stream({ id: crypto.randomUUID(), key: {} }, null, new AbortController().signal)).toEqual({ kind: 'app', code: 'no-session' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('tells the relay’s refusal of a stream’s start from the app’s', async () => {
  vi.stubGlobal('fetch', async () => Response.json({ error: 'relay-traffic-limit' }, { status: 429, headers: { 'x-relay': 'error' } }));
  expect(await stream({ id: crypto.randomUUID(), key: {}, public: 'k' }, request, new AbortController().signal)).toEqual({ kind: 'relay', code: 'relay-traffic-limit' });
});

it('states the account the page holds on the relay and on every stream request', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ error: 'stream-exists' }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  holdAccount('account-a');
  const id = crypto.randomUUID();
  await relay(request);
  await stream({ id, key: {}, public: 'k' }, request, new AbortController().signal);
  stopStream(id);
  dropStream(id);
  expect(fetch.mock.calls.map(([url, init]) => [url, (init.headers as Record<string, string>)['x-account']])).toEqual([
    ['/api/relay', 'account-a'],
    [`/api/streams/${id}`, 'account-a'],
    [`/api/streams/${id}/stop`, 'account-a'],
    [`/api/streams/${id}`, 'account-a'],
  ]);
});

it('labels the start of a call and not a read of one already started', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ error: 'no-session' }, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  holdPulse(true);
  const id = crypto.randomUUID();
  await stream({ id, key: {}, public: 'k' }, request, new AbortController().signal, null, { kind: 'call', role: 'aux', type: 'openai', model: 'gpt-5' });
  await stream({ id, key: {} }, null, new AbortController().signal);
  expect(fetch.mock.calls.map(([, init]) => (init.headers as Record<string, string>)['x-hazelle-pulse'])).toEqual(['aux openai gpt-5', undefined]);
});

// Frames as server/stream-box seals them, for a call this page holds the key to.
async function sealedCall() {
  const id = crypto.randomUUID();
  const mine = await streamKey();
  const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
  const theirs = await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: mine.private.x, y: mine.private.y }, P256, false, []) }, theirs.privateKey, 256);
  const encode = (text: string) => new TextEncoder().encode(text);
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const sealing = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encode(id), info: encode('risu-alpha stream') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const frame = (type: number, seq: number, body: Uint8Array) => {
    const out = new Uint8Array(9 + body.byteLength);
    new DataView(out.buffer).setUint32(0, 5 + body.byteLength);
    out[4] = type;
    new DataView(out.buffer).setUint32(5, seq);
    out.set(body, 9);
    return out;
  };
  const sealed = async (type: number, seq: number, text: string) => {
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setUint32(8, seq);
    return frame(type, seq, new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array([type]) }, sealing, encode(text))));
  };
  return {
    call: { id, key: mine.private, public: mine.public },
    hello: frame(0, 0, new Uint8Array(await crypto.subtle.exportKey('raw', theirs.publicKey))),
    head: await sealed(1, 1, JSON.stringify({ status: 200, statusText: 'OK', headers: [['x-relay', 'upstream']] })),
    data: (seq: number, text: string) => sealed(2, seq, text),
    end: (seq: number) => sealed(3, seq, JSON.stringify({ reason: 'done', ms: 5 })),
    pings: Array.from({ length: 40 }, () => frame(4, 0, new Uint8Array())),
  };
}

// broken: the connection breaks after the last frame, as a body read throws then.
function framed(frames: Uint8Array[], broken = false) {
  let at = 0;
  const pull = (body: ReadableStreamDefaultController<Uint8Array>) => (at < frames.length ? body.enqueue(frames[at++]!) : broken ? body.error(new TypeError('network error')) : body.close());
  return new Response(new ReadableStream({ pull }, { highWaterMark: 0 }), { headers: { 'x-stream': 'frames' } });
}

it('skips the pings of a call that stays silent for long, and reads the whole reply', async () => {
  const { call, hello, head, data, end, pings } = await sealedCall();
  const frames = [hello, ...pings, head, ...pings, await data(2, 'Hello, '), ...pings, await data(3, 'traveler.'), await end(4)];
  vi.stubGlobal('fetch', async () => framed(frames));
  const response = await stream(call, request, new AbortController().signal);
  expect(response instanceof Response && (await response.text())).toBe('Hello, traveler.');
  expect(call).toMatchObject({ took: 5 });
});

it('reads again from the frame after the last one, not after a ping, when the connection breaks', async () => {
  const { call, hello, head, data, end, pings } = await sealedCall();
  const fetch = vi.fn<(url: string) => Promise<Response>>();
  fetch.mockResolvedValueOnce(framed([hello, head, await data(2, 'Hello, '), ...pings], true));
  fetch.mockResolvedValueOnce(framed([hello, ...pings, await data(3, 'traveler.'), await end(4)]));
  vi.stubGlobal('fetch', fetch);
  const response = await stream(call, request, new AbortController().signal);
  expect(response instanceof Response && (await response.text())).toBe('Hello, traveler.');
  expect(fetch.mock.calls[1]![0]).toBe(`/api/streams/${call.id}?from=3`);
});

it('ends reconnects at a permanent account refusal', async () => {
  const fetch = vi.fn(async () => Response.json({ error: 'account-mismatch' }, { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  expect(await stream({ id: crypto.randomUUID(), key: {} }, null, new AbortController().signal)).toEqual({ kind: 'app', code: 'account-mismatch' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('cancels retry bodies and waits for Retry-After before reconnecting', async () => {
  vi.useFakeTimers();
  try {
    const cancel = vi.fn();
    const gone = vi.fn();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 429, headers: { 'retry-after': '120' } }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: gone }), { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const answer = stream({ id: crypto.randomUUID(), key: {} }, null, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ kind: 'app', code: 'stream-gone' });
    expect(gone).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('cancels unused stop, drop and guest-visit response bodies', async () => {
  const canceled = vi.fn();
  vi.stubGlobal('fetch', async (url: string) => url === request.url
    ? new Response('reply')
    : new Response(new ReadableStream({ cancel: canceled })));
  stopStream('call');
  dropStream('call');
  const transport = directTransport('guest');
  const reply = await transport.stream({ id: 'call', key: {} }, request, new AbortController().signal, null, { kind: 'call', role: 'chat', type: 'openai', model: 'm' });
  expect(reply instanceof Response && await reply.text()).toBe('reply');
  await vi.waitFor(() => expect(canceled).toHaveBeenCalledTimes(3));
  transport.close();
});

it('cancels a stream start answered after its caller stopped', async () => {
  const stopped = new AbortController();
  const cancel = vi.fn();
  vi.stubGlobal('fetch', async () => {
    stopped.abort();
    return new Response(new ReadableStream({ cancel }), { headers: { 'x-stream': 'frames' } });
  });
  expect(await stream({ id: 'call', key: {}, public: 'k' }, request, stopped.signal)).toEqual({ kind: 'stopped' });
  expect(cancel).toHaveBeenCalledOnce();
});
