import { PROXY_HEADER, PROXY_HEADERS_HEADER, PROXY_SOURCE, PROXY_TARGET_HEADER, unpackHeaders } from '../contracts/proxy';

// The proxy, a Cloudflare Worker (infra/proxy): it sends on the one call the server hands it and streams the answer
// back as it comes. It holds, logs and caches nothing, and answers only the holder of KEY, so it is no open proxy.
// The target's own checks (https, a public address) are the server's, made before the call reaches here.
type Env = { KEY?: string };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const target = request.headers.get(PROXY_TARGET_HEADER);
    const headers = unpackHeaders(request.headers.get(PROXY_HEADERS_HEADER));
    // Without a KEY set, "Bearer undefined" would open it.
    if (!env.KEY || request.headers.get('authorization') !== `Bearer ${env.KEY}` || !target || !headers) return new Response(null, { status: 401 });
    const answer = await fetch(target, { method: request.method, headers, body: request.body, redirect: 'manual' }).catch(() => null);
    // Here a target that cannot be reached is seldom a thrown error: Cloudflare answers 530 in its place (error 1016 for
    // a name that does not resolve).
    if (!answer || answer.status === 530) return new Response(null, { status: 502, headers: { [PROXY_HEADER]: PROXY_SOURCE.error } });
    const answered = new Headers(answer.headers);
    answered.set(PROXY_HEADER, PROXY_SOURCE.upstream);
    return new Response(answer.body, { status: answer.status, headers: answered });
  },
};
