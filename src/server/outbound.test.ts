import type { LookupAddress } from 'node:dns';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { createServer as createSocketServer, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROXY_HEADER, PROXY_HEADERS_HEADER, PROXY_SOURCE, PROXY_TARGET_HEADER, unpackHeaders } from '../contracts/proxy';
import { localProviders, pinnedLookup, pinnedOutbound, type Resolve } from './outbound';
import { forward, ProxyFailure, type Upstream, type UpstreamInit } from './relay';
import { isPublicAddress, PolicyRefusal } from './ssrf';
import { relayBudget } from './limits';

const createRelay = (upstream: Upstream) => async (request: Request) => forward(upstream, await request.json(), 0, request.signal, relayBudget().account('test'));

// No local address is public, so a test that dials the production dispatcher's pinned connection at a local server
// lets 127.0.0.1 pass as public for its duration.
const policy = vi.hoisted(() => ({ loopbackIsPublic: false }));
vi.mock('./ssrf', async (original) => {
  const real = await original<typeof import('./ssrf')>();
  return { ...real, isPublicAddress: (address: string) => (policy.loopbackIsPublic && address === '127.0.0.1') || real.isPublicAddress(address) };
});

const SLOW_CHUNKS = 50;
const answer = (...addresses: string[]): LookupAddress[] => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
const init = (signal = new AbortController().signal): UpstreamInit => ({ method: 'GET', headers: new Headers(), body: null, redirect: 'manual', signal });

// A local provider: /ok closes its connection after each answer, /redirect points elsewhere, /slow writes a chunk every
// 20 ms and ends after SLOW_CHUNKS of them. slow: what the last /slow response saw. /proxy answers as the proxy does
// with what it was handed, /proxy-error as the proxy that could not reach the provider.
let server: Server;
let port: number;
const slow = { closedEarly: false };
beforeAll(async () => {
  server = createServer((request, response: ServerResponse) => {
    if (request.url === '/ok') return response.writeHead(200, { connection: 'close' }).end('ok');
    if (request.url === '/redirect') return response.writeHead(302, { location: 'http://elsewhere.test/' }).end();
    if (request.url === '/proxy') {
      const handed = { key: request.headers.authorization, target: request.headers[PROXY_TARGET_HEADER], headers: unpackHeaders(request.headers[PROXY_HEADERS_HEADER] as string) };
      return response.writeHead(200, { connection: 'close', [PROXY_HEADER]: PROXY_SOURCE.upstream }).end(JSON.stringify(handed));
    }
    if (request.url === '/proxy-error') return response.writeHead(502, { connection: 'close', [PROXY_HEADER]: PROXY_SOURCE.error }).end();
    let written = 0;
    const timer = setInterval(() => {
      if (++written === SLOW_CHUNKS) {
        clearInterval(timer);
        return response.end('x');
      }
      response.write('x');
    }, 20);
    response.on('close', () => {
      clearInterval(timer);
      slow.closedEarly = !response.writableFinished;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const loopback: Resolve = async () => answer('127.0.0.1');
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof PolicyRefusal ? error.refusal : 'other'),
  );

describe('the local provider list', () => {
  it('reads host:port entries, ignoring spaces and empty ones', () => {
    expect([...localProviders(' host.docker.internal:11434, LOCALHOST:1234,,[::1]:5001 ')]).toEqual(['host.docker.internal:11434', 'localhost:1234', '[::1]:5001']);
    expect(localProviders('').size).toBe(0);
  });

  it('keeps an IPv6 entry as a destination URL spells it', () => {
    expect([...localProviders('[0:0:0:0:0:0:0:1]:11434,[FD00::0001]:80')]).toEqual(['[::1]:11434', '[fd00::1]:80']);
  });

  it.each(['localhost', 'localhost:0', 'localhost:65536', 'http://localhost:11434', 'local host:1', 'localhost:11434/v1', '[:::]:11434', '[127.0.0.1]:80', '2130706433:80'])('refuses to start on %s', (entry) => {
    expect(() => localProviders(`a:1,${entry}`)).toThrow(/HAZELLE_LOCAL_PROVIDERS/);
  });
});

describe('the pinned lookup', () => {
  const ask = (lookup: ReturnType<typeof pinnedLookup>, all: boolean) =>
    new Promise<unknown>((resolve, reject) => lookup('provider.test', { all }, (error, address, family) => (error ? reject(error) : resolve(all ? address : [address, family]))));

  it('answers the validated addresses in the form asked for', async () => {
    const lookup = pinnedLookup(async () => answer('93.184.216.34', '2606:2800:220:1::1'), () => true);
    expect(await ask(lookup, true)).toEqual(answer('93.184.216.34', '2606:2800:220:1::1'));
    expect(await ask(lookup, false)).toEqual(['93.184.216.34', 4]);
  });

  it('refuses an answer with any private address, in either form asked for', async () => {
    const answers = [answer('93.184.216.34', '10.0.0.1'), answer('::ffff:127.0.0.1')];
    const lookup = pinnedLookup(async () => answers.shift()!, isPublicAddress);
    await expect(ask(lookup, true)).rejects.toBeInstanceOf(PolicyRefusal);
    await expect(ask(lookup, false)).rejects.toBeInstanceOf(PolicyRefusal);
  });
});

describe('the outbound', () => {
  it('refuses plain http and private or numeric IP literals before any lookup', async () => {
    const resolve = vi.fn<Resolve>(loopback);
    const outbound = pinnedOutbound(new Set(), null, resolve);
    expect(await refusal(outbound(new URL('http://api.example.com/'), init()))).toBe('not-https');
    for (const url of ['https://10.0.0.1/', 'https://2130706433/', 'https://0x7f.1/', 'https://[::ffff:127.0.0.1]/', 'https://[fd00::1]/']) {
      expect(await refusal(outbound(new URL(url), init()))).toBe('not-public');
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it('refuses a host name that resolves to a private address, or to a public and a private one', async () => {
    expect(await refusal(pinnedOutbound(new Set(), null, loopback)(new URL('https://provider.test/'), init()))).toBe('not-public');
    expect(await refusal(pinnedOutbound(new Set(), null, async () => answer('93.184.216.34', '192.168.0.1'))(new URL('https://provider.test/'), init()))).toBe('not-public');
  });

  // The server ends each connection at once, so the first call fails at its TLS handshake and the next needs a new one.
  it('looks a host up again for a new connection, and refuses it once it answers a private address', async () => {
    let opened = 0;
    const closing = createSocketServer((socket) => {
      opened++;
      socket.destroy();
    });
    await new Promise<void>((resolve) => closing.listen(0, '127.0.0.1', resolve));
    let address = '127.0.0.1';
    const resolve = vi.fn<Resolve>(async () => answer(address));
    const url = new URL(`https://provider.test:${(closing.address() as AddressInfo).port}/`);
    policy.loopbackIsPublic = true;
    try {
      const outbound = pinnedOutbound(new Set(), null, resolve);
      expect(await refusal(outbound(url, init()))).toBe('other');
      expect(opened).toBe(1);
      address = '10.0.0.1';
      expect(await refusal(outbound(url, init()))).toBe('not-public');
      expect([opened, resolve.mock.calls.length]).toEqual([1, 2]);
    } finally {
      policy.loopbackIsPublic = false;
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
  });

  it('tells a policy refusal from a name that does not resolve, at the relay', async () => {
    const nxdomain: Resolve = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND provider.test'), { code: 'ENOTFOUND' });
    };
    const post = (url: string) => new Request('http://localhost/api/relay', { method: 'POST', body: JSON.stringify({ url, method: 'GET', headers: {}, body: null }) });
    const refused = await createRelay(pinnedOutbound(new Set(), null, loopback))(post('https://provider.test/'));
    expect([refused.status, await refused.json()]).toEqual([403, { error: 'not-public' }]);
    const missing = await createRelay(pinnedOutbound(new Set(), null, nxdomain))(post('https://provider.test/'));
    expect([missing.status, await missing.json()]).toEqual([502, { error: 'upstream-unreachable' }]);
  });

  it('lets a listed host:port through over plain http to a private address, looked up again on every connection', async () => {
    const resolve = vi.fn<Resolve>(loopback);
    const outbound = pinnedOutbound(localProviders(`provider.test:${port}`), null, resolve);
    for (let i = 0; i < 2; i++) expect(await (await outbound(new URL(`http://provider.test:${port}/ok`), init())).text()).toBe('ok');
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('refuses the listed host on another port, and a redirect from it to an unlisted host', async () => {
    const outbound = pinnedOutbound(localProviders(`provider.test:${port}`), null, loopback);
    expect(await refusal(outbound(new URL(`http://provider.test:${port + 1}/ok`), init()))).toBe('not-https');
    expect(await refusal(outbound(new URL(`https://provider.test:${port + 1}/ok`), init()))).toBe('not-public');
    const post = new Request('http://localhost/api/relay', { method: 'POST', body: JSON.stringify({ url: `http://provider.test:${port}/redirect`, method: 'GET', headers: {}, body: null }) });
    const redirected = await createRelay(outbound)(post);
    expect([redirected.status, await redirected.json()]).toEqual([502, { error: 'upstream-redirect', status: 302, location: 'http://elsewhere.test/' }]);
  });

  it('hands a call asked through the proxy to it, and tells the proxy\'s own failure from the provider\'s', async () => {
    const through = (path: string | null) => pinnedOutbound(localProviders(`provider.test:${port}`), path === null ? null : { url: `http://provider.test:${port}${path}`, key: 'k' }, loopback);
    const asked = (): UpstreamInit => ({ ...init(), headers: new Headers({ authorization: 'Bearer user' }), proxy: true });
    const target = new URL('https://api.example.com/v1');
    const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof ProxyFailure ? error.failure : error instanceof PolicyRefusal ? error.refusal : 'other'));
    expect(await (await through('/proxy')(target, asked())).json()).toEqual({ key: 'Bearer k', target: target.href, headers: [['authorization', 'Bearer user']] });
    // What answers without the proxy's mark is not the proxy; the provider it could not reach fails as any unreached one.
    expect(await failure(through('/ok')(target, asked()))).toBe('proxy-unreachable');
    expect(await failure(through('/proxy-error')(target, asked()))).toBe('other');
    expect(await failure(through(null)(target, asked()))).toBe('no-proxy');
    expect(await failure(through('/proxy')(new URL('http://api.example.com/'), asked()))).toBe('not-https');
    // The operator's own machine is never asked of the proxy.
    expect(await (await through('/proxy')(new URL(`http://provider.test:${port}/ok`), asked())).text()).toBe('ok');
    const post = () => new Request('http://localhost/api/relay', { method: 'POST', body: JSON.stringify({ url: target.href, method: 'GET', headers: {}, body: null, proxy: true }) });
    const carried = await createRelay(through('/proxy'))(post());
    expect([carried.status, carried.headers.get(PROXY_HEADER), (await carried.json() as { target: string }).target]).toEqual([200, null, target.href]);
    const unreached = await createRelay(through('/ok'))(post());
    expect([unreached.status, await unreached.json()]).toEqual([502, { error: 'proxy-unreachable' }]);
  });

  it('aborts a call mid-body on its signal, closing the connection', async () => {
    const outbound = pinnedOutbound(localProviders(`127.0.0.1:${port}`), null);
    const call = new AbortController();
    const reader = (await outbound(new URL(`http://127.0.0.1:${port}/slow`), init(call.signal))).body!.getReader();
    expect((await reader.read()).done).toBe(false);
    call.abort();
    await expect(reader.read()).rejects.toThrow();
    await vi.waitFor(() => expect(slow.closedEarly).toBe(true));
  });
});
