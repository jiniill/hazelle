import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { forward, type Upstream, type UpstreamInit } from './relay';
import { PolicyRefusal } from './ssrf';
import { relayBudget, type RelayAllowance } from './limits';

// What /api/relay hands forward (server/calls): the body read, and charged as the bytes the client sent.
const relayWithBudget = (upstream: Upstream, allowance: RelayAllowance) => async (request: Request) => {
  const text = await request.text();
  return forward(upstream, await new Response(text).json().catch(() => null), Buffer.byteLength(text), request.signal, allowance);
};
const createRelay = (upstream: Upstream) => relayWithBudget(upstream, relayBudget().account('test'));

const envelope = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://api.example.com/v1/chat/completions',
  method: 'POST',
  headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
  body: '{"stream":true}',
  ...overrides,
});

const post = (body: unknown) =>
  new Request('http://localhost/api/relay', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('relay', () => {
  it('streams upstream chunks before the upstream finishes', async () => {
    let push!: ReadableStreamDefaultController<Uint8Array>;
    const upstreamBody = new ReadableStream<Uint8Array>({ start: (c) => void (push = c) });
    const relay = createRelay(async () => new Response(upstreamBody, { headers: { 'content-type': 'text/event-stream' } }));

    const response = await relay(post(envelope()));
    const reader = response.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    push.enqueue(encoder.encode('data: one\n\n'));
    expect(decoder.decode((await reader.read()).value)).toBe('data: one\n\n');
    push.enqueue(encoder.encode('data: two\n\n'));
    expect(decoder.decode((await reader.read()).value)).toBe('data: two\n\n');
    push.close();
    expect((await reader.read()).done).toBe(true);
  });

  it('forwards the envelope without hop-by-hop or identifying headers', async () => {
    const upstream = vi.fn<Upstream>(async () => new Response('ok'));
    const request = post(
      envelope({
        headers: {
          Authorization: 'Bearer test',
          Host: 'evil.test',
          Cookie: 'a=b',
          'X-Forwarded-For': '10.0.0.1',
          'CF-Connecting-IP': '10.0.0.1',
          Connection: 'keep-alive',
          'anthropic-version': '2023-06-01',
        },
      }),
    );
    await createRelay(upstream)(request);

    const [url, init] = upstream.mock.calls[0] as [URL, UpstreamInit];
    expect(url.href).toBe('https://api.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"stream":true}');
    expect(init.redirect).toBe('manual');
    expect(init.signal.aborted).toBe(false);
    expect([...init.headers.keys()].sort()).toEqual(['anthropic-version', 'authorization']);
  });

  it('passes upstream status and headers through, minus the ones that would mislead the browser', async () => {
    const relay = createRelay(
      async () =>
        new Response('{"error":"rate"}', {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': '3',
            'x-request-id': 'req_1',
            'set-cookie': 'track=1',
            'content-encoding': 'gzip',
            'www-authenticate': 'Basic',
            'clear-site-data': '"cookies", "storage"',
            nel: '{"report_to":"cf-nel"}',
            'x-relay': 'spoofed',
          },
        }),
    );
    const response = await relay(post(envelope()));

    expect(response.status).toBe(429);
    expect(response.headers.get('x-relay')).toBe('upstream');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('3');
    expect(response.headers.get('x-request-id')).toBe('req_1');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(response.headers.get('clear-site-data')).toBeNull();
    expect(response.headers.get('nel')).toBeNull();
    expect(await response.text()).toBe('{"error":"rate"}');
  });

  it('reports a redirect instead of relaying it', async () => {
    const relay = createRelay(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } }));
    const response = await relay(post(envelope()));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-relay')).toBe('error');
    expect(await response.json()).toEqual({ error: 'upstream-redirect', status: 302, location: 'https://elsewhere.test/' });
  });

  it.each([
    ['not JSON', 'nope'],
    ['a missing URL', envelope({ url: undefined })],
    ['an unknown method', envelope({ method: 'CONNECT' })],
    ['a GET with a body', envelope({ method: 'GET' })],
    ['a non-string header', envelope({ headers: { a: 1 } })],
    ['a binary body that is no base64', envelope({ body: 'not base64!', binary: true })],
    ['a binary mark with no body', envelope({ body: null, binary: true })],
  ])('refuses an envelope with %s', async (_label, body) => {
    const upstream = vi.fn<Upstream>();
    const response = await createRelay(upstream)(post(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad-envelope' });
    expect(upstream).not.toHaveBeenCalled();
  });

  it('answers a destination the outbound refused with its reason', async () => {
    const response = await createRelay(async () => {
      throw new PolicyRefusal('not-https');
    })(post(envelope()));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'not-https' });
  });

  it('aborts the upstream call when its client disconnects mid-reply', async () => {
    let aborted = false;
    let sent = 0;
    // Bounded: it ends on its own after 100 chunks.
    const upstream: Upstream = async (_url, { signal }) => {
      signal.addEventListener('abort', () => (aborted = true));
      return new Response(
        new ReadableStream({
          pull: async (body) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (++sent === 100) return body.close();
            body.enqueue(new TextEncoder().encode('data: x\n\n'));
          },
        }),
      );
    };
    const app = new Hono().post('/api/relay', (c) => createRelay(upstream)(c.req.raw));
    const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    const client = httpRequest({ host: '127.0.0.1', port, path: '/api/relay', method: 'POST', headers: { 'content-type': 'application/json' } });
    client.end(JSON.stringify(envelope()));
    const response = await new Promise<IncomingMessage>((resolve) => client.once('response', resolve));
    await new Promise((resolve) => response.once('data', resolve));
    client.destroy();
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(sent).toBeLessThan(100);
    await new Promise((resolve) => server.close(resolve));
  });

  it('reports a failed upstream call as unreachable and logs its codes, not its message', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const relay = createRelay(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.example.com'), { code: 'ENOTFOUND' }) });
    });
    const response = await relay(post(envelope()));

    expect(response.status).toBe(502);
    expect(response.headers.get('x-relay')).toBe('error');
    expect(await response.json()).toEqual({ error: 'upstream-unreachable' });
    const line = String(logged.mock.calls[0]?.[0]);
    expect([JSON.parse(line).codes, line.includes('example')]).toEqual([['ENOTFOUND'], false]);
    logged.mockRestore();
  });
});

it('charges UTF-8 request bodies before sending and rejects the next host before calling it', async () => {
  const upstream = vi.fn<Upstream>(async () => new Response(null, { status: 204 }));
  const relay = relayWithBudget(upstream, relayBudget(2 * (Buffer.byteLength(JSON.stringify(envelope({ body: '한' }))) + 2), 1).account('a'));
  expect((await relay(post(envelope({ body: '한' })))).status).toBe(204);
  const host = await relay(post(envelope({ url: 'https://another.test', body: null })));
  expect([host.status, host.headers.get('x-relay'), await host.json()]).toEqual([429, 'error', { error: 'relay-host-limit' }]);
  expect((await relay(post(envelope({ body: '한' })))).status).toBe(204);
  const spent = await relay(post(envelope({ body: null })));
  expect([spent.status, await spent.json()]).toEqual([429, { error: 'relay-traffic-limit' }]);
  expect(upstream).toHaveBeenCalledTimes(2);
});

it('shares response bytes between concurrent calls and aborts without forwarding an over-budget chunk', async () => {
  const signals: AbortSignal[] = [];
  const cancel = vi.fn();
  const upstream: Upstream = async (_url, init) => {
    signals.push(init.signal);
    return new Response(new ReadableStream<Uint8Array>({
      pull: (controller) => controller.enqueue(new Uint8Array(3)),
      cancel,
    }, { highWaterMark: 0 }), { headers: { 'content-length': '1', 'content-type': 'text/event-stream' } });
  };
  const overhead = Buffer.byteLength(JSON.stringify(envelope({ body: null }))) + Buffer.byteLength(JSON.stringify([['content-length', '1'], ['content-type', 'text/event-stream']]));
  const relay = relayWithBudget(upstream, relayBudget(2 * overhead + 5).account('a'));
  const replies = await Promise.all([relay(post(envelope({ body: null }))), relay(post(envelope({ body: null })))]);
  const readers = replies.map((reply) => reply.body!.getReader());
  expect((await readers[0]!.read()).value).toHaveLength(3);
  await expect(readers[1]!.read()).rejects.toThrow('relay-traffic-limit');
  await expect(readers[0]!.read()).rejects.toThrow('relay-traffic-limit');
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('cancels HTML responses before their body is read', async () => {
  const pull = vi.fn();
  const cancel = vi.fn();
  const relay = createRelay(async () => new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
    headers: { 'content-type': 'Text/HTML; charset=utf-8' },
  }));
  const response = await relay(post(envelope()));
  expect([response.status, response.headers.get('x-relay'), await response.json()]).toEqual([502, 'error', { error: 'upstream-not-api' }]);
  expect(pull).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});

it('passes an HTML error page on as its status alone', async () => {
  const cancel = vi.fn();
  const relay = createRelay(async () => new Response(new ReadableStream({ cancel }), { status: 403, headers: { 'content-type': 'text/html' } }));
  const response = await relay(post(envelope()));
  expect([response.status, response.headers.get('x-relay'), response.headers.get('content-type'), await response.text()]).toEqual([403, 'upstream', null, '']);
  expect(cancel).toHaveBeenCalledOnce();
});

it('sends a binary body as the bytes its base64 holds', async () => {
  const upstream = vi.fn<Upstream>(async () => Response.json({ ok: true }));
  const response = await createRelay(upstream)(post(envelope({ body: Buffer.from([0, 255, 137, 80]).toString('base64'), binary: true })));
  expect(response.status).toBe(200);
  expect(upstream.mock.calls[0]![1].body).toEqual(new Uint8Array([0, 255, 137, 80]));
});

it('refuses mutation methods outside the provider GET/POST contract before reaching a destination', async () => {
  const upstream = vi.fn<Upstream>();
  const response = await createRelay(upstream)(post(envelope({ method: 'DELETE', body: null })));
  expect([response.status, await response.json()]).toEqual([400, { error: 'bad-envelope' }]);
  expect(upstream).not.toHaveBeenCalled();
});

it('answers an upstream status no response can carry as unreachable, ending the call, and passes no reason phrase on', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cancel = vi.fn();
  const signals: AbortSignal[] = [];
  const answering = (status: number, statusText: string) =>
    createRelay(async (_url, init) => {
      signals.push(init.signal);
      return Object.defineProperties(new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'text/event-stream' } }), { status: { value: status }, statusText: { value: statusText } });
    });
  for (const status of [999, 600]) {
    const response = await answering(status, 'X')(post(envelope()));
    expect([response.status, response.headers.get('x-relay'), await response.json()]).toEqual([502, 'error', { error: 'upstream-unreachable' }]);
  }
  expect([signals.map((signal) => signal.aborted), cancel.mock.calls.length]).toEqual([[true, true], 2]);
  const phrased = await answering(200, 'OK\x01')(post(envelope()));
  expect([phrased.status, phrased.statusText, phrased.headers.get('x-relay')]).toEqual([200, '', 'upstream']);
  await phrased.body!.cancel();
  logged.mockRestore();
});
