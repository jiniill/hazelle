import { ACCOUNT_HEADER, RELAY_HEADER, ACCOUNT_USAGE_HEADERS, PULSE_HEADER, UNREAD_BOARD_HEADER, UNREAD_NOTICES_HEADER, VERSION_HEADER } from '../contracts/http';
import { pulseHeader, type PulseLabel } from '../contracts/pulse';
import { isRecord } from '../connectors/values';

export type ApiFailure = { ok: false; error: string; retryAfter?: number; status?: number };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

// What an answer says of the account the page holds rather than of the request.
export type Heard = { kind: 'elsewhere' } | { kind: 'suspended' } | { kind: 'storage-full' } | { kind: 'restoring' } | { kind: 'bytes'; bytes: number } | { kind: 'file-bytes'; fileBytes: number } | { kind: 'notices'; unread: number } | { kind: 'board'; unread: number };

const REFUSALS: Record<string, 'elsewhere' | 'suspended' | 'storage-full' | 'restoring'> = {
  'account-mismatch': 'elsewhere',
  suspended: 'suspended',
  'storage-full': 'storage-full',
  'account-restoring': 'restoring',
};

// Every request states it, and the server refuses one whose cookie has come to name another account (server/session).
let held: string | null = null;
let generation = 0;
let hear: ((heard: Heard) => void) | null = null;

export const hasAccount = () => held !== null;

export function holdAccount(account: string | null, onHeard: ((heard: Heard) => void) | null = null) {
  generation++;
  held = account;
  hear = onHeard;
}

// Only fetchApi applies sharing labels. An owed page-load seen rides the next request sent while sharing.
let sharing = false;
let seenOwed = false;

export function holdPulse(on: boolean) {
  sharing = on;
  if (!on) seenOwed = false;
}

export function markSeen() {
  seenOwed = true;
}

// The release the server last said it runs, and who hears when that changes; apart from holdAccount's listener, since
// the release is not of the account.
let served: string | null = null;
let hearServed: ((version: string) => void) | null = null;

export function hearServedVersion(listener: ((version: string) => void) | null) {
  hearServed = listener;
  if (listener && served !== null) listener(served);
}

// Every request to this app's server leaves through here (api, and runtime/relay's raw ones).
// pulse: a provider call's label, which marks the account active too and so settles an owed seen.
export async function fetchApi(path: string, { pulse, ...init }: Omit<RequestInit, 'headers'> & { headers?: Record<string, string>; pulse?: PulseLabel } = {}): Promise<Response> {
  const sent = generation;
  const label = sharing ? (pulse ?? (seenOwed ? ({ kind: 'seen' } as const) : null)) : null;
  if (label) seenOwed = false;
  const response = await fetch(`/api/${path}`, { ...init, headers: { ...(held === null ? {} : { [ACCOUNT_HEADER]: held }), ...(label && { [PULSE_HEADER]: pulseHeader(label) }), ...init.headers } });
  // An immutable answer (a picture) may come from the browser's cache, carrying the release that first served it.
  const version = response.headers.get('cache-control')?.includes('immutable') ? null : response.headers.get(VERSION_HEADER);
  if (version !== null && version !== served) {
    served = version;
    hearServed?.(version);
  }
  const tell = hear;
  if (!tell || sent !== generation) return response;
  const bytes = response.headers.get(ACCOUNT_USAGE_HEADERS.bytes);
  const fileBytes = response.headers.get(ACCOUNT_USAGE_HEADERS.fileBytes);
  if (bytes !== null) tell({ kind: 'bytes', bytes: Number(bytes) });
  if (fileBytes !== null) tell({ kind: 'file-bytes', fileBytes: Number(fileBytes) });
  const unread = response.headers.get(UNREAD_NOTICES_HEADER);
  if (unread !== null) tell({ kind: 'notices', unread: Number(unread) });
  const board = response.headers.get(UNREAD_BOARD_HEADER);
  if (board !== null) tell({ kind: 'board', unread: Number(board) });
  // A provider's refusal comes through the relay marked x-relay, and its body is the provider's to read.
  if ((response.status === 403 || response.status === 409 || response.status === 413 || response.status === 503) && !response.headers.has(RELAY_HEADER)) {
    const body = await readBody(response.clone(), init.signal).then((bytes) => parse(new TextDecoder().decode(bytes))).catch(() => null);
    if (sent !== generation) return response;
    const kind = isRecord(body) && typeof body.error === 'string' ? REFUSALS[body.error] : undefined;
    if (kind === 'elsewhere') hear = null;
    if (kind) tell({ kind });
  }
  return response;
}

// Header wait scales with upload bytes at SLOWEST_UPLOAD (24 concurrent files share one slow uplink).
// Keep timeouts out of fetchApi, which also carries relay streams.
const HEADERS_WAIT = 15_000;
const SLOWEST_UPLOAD = 8_192;
const BODY_WAIT = 15_000;
// For a route whose server work runs inside the request and can outlast HEADERS_WAIT: 탈퇴's store wipe, an operator's
// account removal or restore. Timed out, such a request reads as 'offline' while the server may still finish it.
export const SLOW_ROUTE_WAIT = 5 * 60_000;

// offline means no complete app answer, including dropped/timed-out reads and proxy-shaped 5xx responses.
// server-error is a complete unrecognized response with its status.
export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal, headersWait = HEADERS_WAIT, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const bytes = body instanceof Uint8Array ? (body as Uint8Array<ArrayBuffer>) : null;
  const payload = body === undefined ? undefined : (bytes ?? JSON.stringify(body));
  const late = new AbortController();
  let timer = setTimeout(() => late.abort(), headersWait + ((payload?.length ?? 0) / SLOWEST_UPLOAD) * 1000);
  const stopped = signal ? AbortSignal.any([signal, late.signal]) : late.signal;
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => late.abort(), BODY_WAIT);
  };
  let response: Response;
  let answer: Uint8Array | string;
  try {
    response = await fetchApi(path, {
      method,
      signal: stopped,
      headers: method === 'GET' ? headers : { ...headers, 'content-type': bytes ? 'application/octet-stream' : 'application/json' },
      body: payload,
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const readBytes = response.ok && response.headers.get('content-type') === 'application/octet-stream';
    // Idle, never total: a sync page of a few MB on a slow phone line may take minutes and still be arriving.
    progress();
    const data = await readBody(response, stopped, progress);
    answer = readBytes ? data : new TextDecoder().decode(data);
  } catch {
    return { ok: false, error: signal?.aborted ? 'stopped' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
  if (signal?.aborted) return { ok: false, error: 'stopped' };
  const data = typeof answer === 'string' ? parse(answer) : answer;
  if (response.ok && data !== null) return { ok: true, data: data as T };
  if (isRecord(data) && typeof data.error === 'string') {
    const retryAfter = typeof data.retryAfter === 'number' ? data.retryAfter : undefined;
    return { ok: false, error: data.error, retryAfter };
  }
  if (response.status >= 500) return { ok: false, error: 'offline' };
  return { ok: false, error: 'server-error', status: response.status };
}

async function readBody(response: Response, signal?: AbortSignal | null, progress?: () => void): Promise<Uint8Array> {
  signal?.throwIfAborted();
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const stop = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (value.byteLength) progress?.();
      chunks.push(value);
      length += value.byteLength;
    }
  } finally {
    signal?.removeEventListener('abort', stop);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Writes sent together, each shown at once: the first failure among them, or ok once all landed.
export async function allWritten(writes: Promise<ApiResult<unknown>>[]): Promise<ApiResult<null>> {
  const results = await Promise.all(writes);
  return results.find((result): result is ApiFailure => !result.ok) ?? { ok: true, data: null };
}
