import { RELAY_HEADER, type RelayError } from '../contracts/http';
import { HOP_BY_HOP } from './hop-by-hop';
import { isRecord } from './http';
import { PolicyRefusal } from './ssrf';
import type { RelayAllowance } from './limits';

export type UpstreamInit = {
  method: string;
  headers: Headers;
  body: string | null;
  redirect: 'manual';
  signal: AbortSignal;
};

// Rejects with PolicyRefusal for a destination the outbound policy refuses (outbound.ts), with anything else for a call
// that failed on the way.
export type Upstream = (url: URL, init: UpstreamInit) => Promise<Response>;

type Envelope = { url: URL; method: string; headers: Record<string, string>; body: string | null };

const METHODS = new Set(['GET', 'POST']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const DROPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP,
  'proxy-connection',
  'host',
  'cookie',
  'content-length',
  'forwarded',
  'x-real-ip',
]);
const DROPPED_REQUEST_PREFIXES = ['x-forwarded-', 'cf-'];

// fetch decodes bodies: drop stale encoding/length. Drop www-authenticate to prevent browser login prompts.
// Origin-scoped headers must not let providers clear app sessions/vault caches or redirect error reports.
const DROPPED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP,
  'set-cookie',
  'content-encoding',
  'content-length',
  'www-authenticate',
  'clear-site-data',
  'nel',
  'report-to',
  'reporting-endpoints',
  'strict-transport-security',
  'alt-svc',
]);

export class RelayTrafficLimit extends Error {
  constructor() {
    super('relay-traffic-limit');
  }
}

// stream-box.ts calls it with a signal of its own, so the call outlives the client's request. bytes: the request body the
// client sent for the call (calls.ts), the whole envelope with its URL and headers.
export async function forward(upstream: Upstream, body: unknown, bytes: number, signal: AbortSignal, allowance: RelayAllowance): Promise<Response> {
  const envelope = parseEnvelope(body);
  if (!envelope) return refuse(400, 'bad-envelope');
  if (!allowance.visit(envelope.url)) return refuse(429, 'relay-host-limit');
  // Counting only the envelope's body would leave large GETs free. Charge every retry; failed attempts are not
  // refunded. No request content is retained by the allowance.
  if (!allowance.take(bytes)) return refuse(429, 'relay-traffic-limit');
  const call = new AbortController();
  const upstreamSignal = AbortSignal.any([signal, call.signal]);

  let response: Response;
  try {
    response = await upstream(envelope.url, {
      method: envelope.method,
      headers: outboundHeaders(envelope.headers),
      body: envelope.body,
      redirect: 'manual',
      signal: upstreamSignal,
    });
  } catch (error) {
    if (error instanceof PolicyRefusal) return refuse(403, error.refusal);
    // The client or the stream ended the call: nothing failed on the way.
    if (upstreamSignal.aborted) return refuse(502, 'upstream-unreachable');
    return unreachable({ codes: errorCodes(error) });
  }

  // A Response carries 200 to 599 alone. Never left to its constructor: the server's Response (@hono/node-server)
  // builds the real one only when it is first read, past this call's cleanup.
  if (response.status < 200 || response.status > 599) {
    call.abort();
    await response.body?.cancel().catch(() => {});
    return unreachable({ status: response.status });
  }

  if (!allowance.take(Buffer.byteLength(JSON.stringify([...response.headers])))) {
    call.abort();
    await response.body?.cancel().catch(() => {});
    return refuse(429, 'relay-traffic-limit');
  }

  // A browser fetch would follow a relayed 3xx on its own, so the redirect is reported instead.
  if (REDIRECTS.has(response.status)) {
    await response.body?.cancel();
    return refuse(502, 'upstream-redirect', { status: response.status, location: response.headers.get('location') });
  }

  // Reject successful HTML so relay cannot fetch web pages. Preserve error-page status for useful refusals,
  // but discard HTML bodies (e.g. proxy/Cloudflare errors).
  const media = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const page = media === 'text/html' || media === 'application/xhtml+xml';
  if (page) {
    call.abort();
    await response.body?.cancel().catch(() => {});
    if (response.ok) return refuse(502, 'upstream-not-api');
  }

  const headers = new Headers();
  response.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name) && !(page && name === 'content-type')) headers.set(name, value);
  });
  headers.set(RELAY_HEADER, 'upstream');
  headers.set('cache-control', 'no-store');
  const reader = page ? undefined : response.body?.getReader();
  const metered = reader
    ? new ReadableStream<Uint8Array>(
        {
          pull: async (controller) => {
            try {
              const { done, value } = await reader.read();
              if (done) return controller.close();
              // fetch has decompressed these bytes. Never trust Content-Length or forward an over-budget chunk.
              if (!allowance.take(value.byteLength)) throw new RelayTrafficLimit();
              controller.enqueue(value);
            } catch (error) {
              call.abort();
              void reader.cancel().catch(() => {});
              controller.error(error);
            }
          },
          cancel: async () => {
            call.abort();
            await reader.cancel().catch(() => {});
          },
        },
        { highWaterMark: 0 },
      )
    : null;
  // No reason phrase: no client reads one, HTTP/2 carries none, and one with a control character is no Response's.
  return new Response(metered, { status: response.status, headers });
}

function parseEnvelope(value: unknown): Envelope | null {
  if (!isRecord(value)) return null;
  const { url, method, headers, body } = value;
  if (typeof url !== 'string' || !URL.canParse(url)) return null;
  if (typeof method !== 'string' || !METHODS.has(method)) return null;
  if (typeof headers !== 'object' || headers === null) return null;
  if (!Object.values(headers).every((v) => typeof v === 'string')) return null;
  if (body !== null && typeof body !== 'string') return null;
  if (method === 'GET' && body !== null) return null;
  return { url: new URL(url), method, headers: headers as Record<string, string>, body };
}

function outboundHeaders(input: Record<string, string>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    const key = name.toLowerCase();
    if (DROPPED_REQUEST_HEADERS.has(key) || DROPPED_REQUEST_PREFIXES.some((p) => key.startsWith(p))) continue;
    headers.set(key, value);
  }
  return headers;
}

// Log transport codes only, never URL/host/headers/body/error messages, which may identify destinations or secrets.
function unreachable(detail: { codes: string[] } | { status: number }): Response {
  console.error(JSON.stringify({ at: new Date().toISOString(), event: 'relay unreachable', ...detail }));
  return refuse(502, 'upstream-unreachable');
}

function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  for (let at = error; at instanceof Error; at = at.cause) {
    const { code } = at as NodeJS.ErrnoException;
    if (code) codes.push(code);
  }
  return codes;
}

export function refuse(status: number, error: RelayError, detail: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...detail }, { status, headers: { [RELAY_HEADER]: 'error', 'cache-control': 'no-store' } });
}
