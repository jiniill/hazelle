import { afterEach, expect, it, vi } from 'vitest';
import { PROXY_HEADER, PROXY_HEADERS_HEADER, PROXY_TARGET_HEADER, packHeaders } from '../contracts/proxy';
import worker from './worker';

afterEach(() => vi.unstubAllGlobals());

const call = (headers: Record<string, string>) => new Request('https://proxy.example/', { method: 'POST', body: '{"q":1}', headers });
const asked = { authorization: 'Bearer k', [PROXY_TARGET_HEADER]: 'https://provider.example/v1/chat', [PROXY_HEADERS_HEADER]: packHeaders([['authorization', 'Bearer 사용자-key']]) };

it('sends the call on with the target\'s own headers and marks the provider\'s answer, whatever its status', async () => {
  const sent = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }));
  vi.stubGlobal('fetch', sent);
  const answer = await worker.fetch(call(asked), { KEY: 'k' });
  const [url, init] = sent.mock.calls[0]!;
  expect(url).toBe('https://provider.example/v1/chat');
  expect(init).toMatchObject({ method: 'POST', headers: [['authorization', 'Bearer 사용자-key']], redirect: 'manual' });
  expect(await new Response(init.body).text()).toBe('{"q":1}');
  expect([answer.status, answer.headers.get('retry-after'), answer.headers.get(PROXY_HEADER), await answer.text()]).toEqual([429, '7', 'upstream', 'slow down']);
});

it('answers no one without its key, least of all when none is set, and says so when the provider cannot be reached', async () => {
  const sent = vi.fn(async () => { throw new TypeError('fetch failed'); });
  vi.stubGlobal('fetch', sent);
  for (const [headers, env] of [[{ ...asked, authorization: 'Bearer other' }, { KEY: 'k' }], [{ ...asked, authorization: 'Bearer undefined' }, {}]] as const) {
    const refused = await worker.fetch(call(headers), env);
    expect([refused.status, refused.headers.get(PROXY_HEADER)]).toEqual([401, null]);
  }
  expect(sent).not.toHaveBeenCalled();
  for (const failure of [async () => { throw new TypeError('fetch failed'); }, async () => new Response('error code: 1016', { status: 530 })]) {
    vi.stubGlobal('fetch', failure);
    const unreached = await worker.fetch(call(asked), { KEY: 'k' });
    expect([unreached.status, unreached.headers.get(PROXY_HEADER)]).toEqual([502, 'error']);
  }
});
