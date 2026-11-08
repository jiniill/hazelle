import type { ModelSettings } from '../connectors/settings';
import type { ApiResult } from './api';
import type { PreparedChat } from '../connectors/preparation';
import type { CallCalibration, InputMeasurement, TokenFit } from '../model/token-calibration';
import { BOT_HEADER, RELAY_HEADER, RELAY_SOURCE, STREAM_FRAMES, STREAM_HEADER } from '../contracts/http';
import { HEAD, DATA, END, PING, PING_MS, WAIT, askedWait, retryWait, type Retry, type StreamStart } from '../contracts/streams';
import { providerCode, providerMessage } from '../connectors/errors';
import { isRecord } from '../connectors/values';
import type { ConnectionType } from '../connectors/types';
import type { HttpRequest } from '../contracts/http';
import type { GuestStep } from '../contracts/admin';
import type { PulseLabel } from '../contracts/pulse';
import { streamOpener } from '../vault/streams';
import { discardBody, fetchApi } from './api';
import { pause } from './pause';
import { CONNECTION_TYPES } from '../connectors/registry';

// Preserve refusal ownership: X-Relay: error is the relay's; no X-Relay means the app's (e.g. expired session).
// Provider code and Retry-After stay distinct from app/relay errors.
export type RelayFailure =
  | { kind: 'provider'; status: number; detail: string; code?: string; retryAfter?: string }
  // location: where a refused redirect pointed.
  | { kind: 'relay'; code: string; location?: string }
  | { kind: 'app'; code: string }
  | { kind: 'offline' }
  | { kind: 'stopped' };

export type JsonAnswer = { ok: true; data: unknown } | { ok: false; failure: RelayFailure };

const lost = (signal?: AbortSignal): RelayFailure => (signal?.aborted ? { kind: 'stopped' } : { kind: 'offline' });

export type Transport = {
  detached: boolean;
  problem(type?: ConnectionType | null): Extract<RelayFailure, { kind: 'app' }> | null;
  close(): void;
  raw(request: HttpRequest, signal?: AbortSignal, bot?: string, pulse?: PulseLabel, type?: ConnectionType | null): Promise<Response | RelayFailure>;
  stream(call: StreamCall, request: HttpRequest | null, signal: AbortSignal, retry?: Retry | null, pulse?: PulseLabel, type?: ConnectionType | null): Promise<Response | RelayFailure>;
  stop(id: string): void;
  drop(id: string): void;
  connected(): void;
};

export const accountTransport: Transport = { detached: true, problem: () => null, close: () => {}, raw: accountRaw, stream: accountStream, stop: (id) => accountStop(id), drop: (id) => accountDrop(id), connected: () => {} };

// Like api's held account, the one open session owns the page's provider transport. Never infer it from cookies.
let transport = accountTransport;
export const holdTransport = (held: Transport) => { transport = held; };
export const detachedReplies = () => transport.detached;
export const transportProblem = (type: ConnectionType | null | undefined) => transport.problem(type);
export const relayRaw = (request: HttpRequest, signal?: AbortSignal, bot?: string, pulse?: PulseLabel, type?: ConnectionType | null) => transport.raw(request, signal, bot, pulse, type);
export const stream = (call: StreamCall, request: HttpRequest | null, signal: AbortSignal, retry: Retry | null = null, pulse?: PulseLabel, type?: ConnectionType | null) => transport.stream(call, request, signal, retry, pulse, type);
export const stopStream = (id: string) => transport.stop(id);
export const dropStream = (id: string) => transport.drop(id);

// A guest's steps never pass the server; its browser reports them to the operator's daily counts (server/visits.ts).
export const countGuest = (guest: string, step: GuestStep) =>
  void fetchApi('visits/guest', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest, step }) }).then((response) => discardBody(response.body)).catch(() => {
    // A missing usage count must not fail the guest's session, connection or reply.
  });

// guest: whose steps count toward the operator's daily figures; null, a session that is nobody's and counts nothing.
export function directTransport(guest: string | null): Transport {
  const count = (step: GuestStep) => {
    if (guest) countGuest(guest, step);
  };
  const calls = new Map<string, AbortController>();
  const closing = new AbortController();
  const problem: Transport['problem'] = (type) => type?.browser === false ? { kind: 'app', code: 'needs-account' } : null;
  const raw: Transport['raw'] = async (request, signal, _bot, pulse, type) => {
    // Sign-in runs before a connection exists, so its type is found from the registry's OAuth addresses.
    if (type === undefined) type = CONNECTION_TYPES.find(({ signIn }) => signIn && [signIn.codeUrl, signIn.tokenUrl, signIn.account.request('').url].includes(request.url));
    const refused = problem(type);
    if (refused) return refused;
    signal = signal ? AbortSignal.any([signal, closing.signal]) : closing.signal;
    if (signal.aborted) return lost(signal);
    try {
      const response = await fetch(request.url, { method: request.method, headers: { ...request.headers, ...(type?.browser && type.browser.headers) }, body: request.body, signal, credentials: 'omit' });
      if (response.ok && pulse?.kind === 'call' && pulse.role === 'chat' && !closing.signal.aborted) count('replied');
      return response;
    } catch {
      // Fetch deliberately does not distinguish CORS, DNS and a lost connection.
      return lost(signal);
    }
  };
  return {
    detached: false,
    problem,
    close: () => { closing.abort(); calls.clear(); },
    raw,
    stream: async (call, request, signal, retry = null, pulse, type) => {
      if (!request) return { kind: 'app', code: 'needs-account' };
      const stopping = new AbortController();
      calls.set(call.id, stopping);
      const canceled = AbortSignal.any([signal, stopping.signal, closing.signal]);
      // Keep the controller through body consumption: stop must still abort the provider's SSE.
      canceled.addEventListener('abort', () => calls.delete(call.id), { once: true });
      for (let tries = 1; ; tries++) {
        call.tries = tries;
        const response = await raw(request, canceled, call.bot, undefined, type);
        const again = response instanceof Response ? retry?.statuses.includes(response.status) : response.kind === 'offline';
        const retryAfter = again && response instanceof Response ? askedWait(response.headers.get('retry-after'), await response.clone().json().catch(() => null)) : null;
        const wait = again && retry && tries <= retry.times ? retryWait(tries, retryAfter, Date.now()) : null;
        if (wait === null) {
          if (response instanceof Response && response.ok && pulse?.kind === 'call' && pulse.role === 'chat' && !closing.signal.aborted) count('replied');
          return answered(response);
        }
        if (response instanceof Response) await discardBody(response.body);
        call.retrying?.();
        if (!(await pause(wait, canceled))) return { kind: 'stopped' };
      }
    },
    stop: (id) => { calls.get(id)?.abort(); calls.delete(id); },
    drop: (id) => { calls.delete(id); },
    connected: () => count('connected'),
  };
}

// The provider's answer, whatever its status. bot: the chat whose bot's script makes the call (BOT_HEADER). pulse: a
// provider call's 헤이젤 나우 label, sent to this app's server beside the request and never in request.headers, which
// the relay forwards to the provider.
async function accountRaw(request: HttpRequest, signal?: AbortSignal, bot?: string, pulse?: PulseLabel): Promise<Response | RelayFailure> {
  let response: Response;
  try {
    response = await fetchApi('relay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(bot !== undefined && { [BOT_HEADER]: bot }) },
      body: JSON.stringify(request),
      signal,
      pulse,
    });
  } catch {
    return lost(signal);
  }
  return sourced(response);
}

async function sourced(response: Response): Promise<Response | RelayFailure> {
  const source = response.headers.get(RELAY_HEADER);
  if (source === RELAY_SOURCE.upstream) return response;
  const body: unknown = await response.json().catch(() => null);
  const code = codeOf(body);
  if (source !== RELAY_SOURCE.error) return { kind: 'app', code };
  return { kind: 'relay', code, ...(isRecord(body) && typeof body.location === 'string' && { location: body.location }) };
}

const codeOf = (body: unknown) => (isRecord(body) && typeof body.error === 'string' ? body.error : 'server-error');
const errorCode = async (response: Response) => codeOf(await response.json().catch(() => null));

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

async function answered(response: Response | RelayFailure): Promise<Response | RelayFailure> {
  if (!(response instanceof Response) || response.ok) return response;
  const text = await response.text().catch(() => '');
  const code = providerCode(text);
  const retryAfter = askedWait(response.headers.get('retry-after'), parsed(text));
  return { kind: 'provider', status: response.status, detail: providerMessage(text), ...(code !== null && { code }), ...(retryAfter !== null && { retryAfter }) };
}

export async function relay(request: HttpRequest, signal?: AbortSignal, bot?: string, pulse?: PulseLabel, type?: ConnectionType | null): Promise<Response | RelayFailure> {
  return answered(await relayRaw(request, signal, bot, pulse, type));
}

export async function relayJson(request: HttpRequest, signal?: AbortSignal, bot?: string, pulse?: PulseLabel, type?: ConnectionType | null): Promise<JsonAnswer> {
  return readJson(await relay(request, signal, bot, pulse, type), signal);
}

export type BytesAnswer = { ok: true; bytes: Uint8Array<ArrayBuffer>; type: string | null } | { ok: false; failure: RelayFailure };

// A body that is not text, such as a picture, with its content type.
export async function relayBytes(request: HttpRequest, signal: AbortSignal, pulse: PulseLabel, type?: ConnectionType | null): Promise<BytesAnswer> {
  const response = await relay(request, signal, undefined, pulse, type);
  if (!(response instanceof Response)) return { ok: false, failure: response };
  try {
    return { ok: true, bytes: new Uint8Array(await response.arrayBuffer()), type: response.headers.get('content-type') };
  } catch {
    return { ok: false, failure: lost(signal) };
  }
}

// OAuth puts its refusals in a JSON body for the caller to read: RFC 8628 answers "not yet" with a 400.
export async function relayOAuth(request: HttpRequest, signal?: AbortSignal): Promise<JsonAnswer> {
  return readJson(await relayRaw(request, signal), signal);
}

async function readJson(response: Response | RelayFailure, signal?: AbortSignal): Promise<JsonAnswer> {
  if (!(response instanceof Response)) return { ok: false, failure: response };
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { ok: false, failure: lost(signal) };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, failure: { kind: 'provider', status: response.status, detail: text.trim().slice(0, 300) } };
  }
}

// Detached calls outlive readers: a request starts one; no request replays it from the beginning (tech-spec §6).
// key is private; public is sent at startup. started fires before reading, or with the accepted batch id.
// retrying fires before each resend; bot identifies the chat for script-call limits. tries comes from the head;
// took is server-measured duration, available only after the end.
export type StreamCall = { preflight?: (settings: ModelSettings, signal: AbortSignal) => Promise<ApiResult<TokenFit>>; calibration?: CallCalibration; measure?: (prepared: PreparedChat) => Promise<InputMeasurement>; id: string; key: JsonWebKey; public?: string; started?: (batch?: string) => void; retrying?: () => void; bot?: string; took?: number; tries?: number };

// Until reader cancellation, retry recoverable read failures: a network failure
// must not become the result of a still-running call. retry resends only before output; pulse labels starts, never resumes.
async function accountStream(call: StreamCall, request: HttpRequest | null, signal: AbortSignal, retry: Retry | null = null, pulse?: PulseLabel): Promise<Response | RelayFailure> {
  let body: ReadableStream<Uint8Array>;
  if (request) {
    let response: Response;
    try {
      response = await fetchApi(`streams/${call.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: call.public, request, ...(call.bot && { bot: call.bot }), ...(retry && { retry }) } satisfies StreamStart), signal, pulse });
    } catch {
      return lost(signal);
    }
    if (response.headers.get(STREAM_HEADER) !== STREAM_FRAMES || !response.body) return sourced(response);
    // A call stopped as its start was answered gets no marker: whoever stopped it ends it, and a marker landing after
    // that end would be picked up as a call to save.
    if (signal.aborted) {
      void discardBody(response.body);
      return lost(signal);
    }
    call.started?.();
    body = response.body;
  } else {
    let reached: ReadableStream<Uint8Array> | RelayFailure;
    try {
      reached = await reach(call.id, 0, 0, signal);
    } catch {
      return lost(signal);
    }
    if (!(reached instanceof ReadableStream)) return reached;
    body = reached;
  }
  return answered(await unframe(call, body, signal));
}

const accountStop = (id: string) => void fetchApi(`streams/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' } }).then((response) => discardBody(response.body)).catch(() => {
  // A refused stop leaves the call running until it is dropped.
});

const accountDrop = (id: string) => void fetchApi(`streams/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } }).then((response) => discardBody(response.body)).catch(() => {
  // Once the call's result is saved. A refused drop leaves the server's copy until it expires on its own.
});

// A network failure must not end a still-running call; permanent refusals must not reconnect it.
async function reach(id: string, from: number, tries: number, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | RelayFailure> {
  let wait = tries ? Math.min(1000 * 2 ** (tries - 1), 30_000) : 0;
  for (; ; tries++) {
    if (wait) await pause(wait, signal);
    signal.throwIfAborted();
    const response = await fetchApi(`streams/${id}?from=${from}`, { signal }).catch(() => null);
    if (response?.ok && response.headers.get(STREAM_HEADER) === STREAM_FRAMES && response.body) return response.body;
    if (response?.status === 404) {
      void discardBody(response.body);
      return { kind: 'app', code: 'stream-gone' };
    }
    const retryAfter = response?.headers.get('retry-after') ?? null;
    const next = retryWait(Math.min(tries, 5), retryAfter, Date.now(), Infinity);
    if (response && ![408, 429, 500, 502, 503, 504].includes(response.status)) {
      return { kind: response.headers.get(RELAY_HEADER) === RELAY_SOURCE.error ? 'relay' : 'app', code: await errorCode(response) };
    }
    void discardBody(response?.body);
    wait = retryAfter === null ? Math.min(next!, 30_000) : next!;
  }
}

const NO_BODY = new Set([101, 204, 205, 304]);

async function unframe(call: StreamCall, body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Response | RelayFailure> {
  const frames = framesOf(call.id, body, signal);
  let open: Awaited<ReturnType<typeof streamOpener>>;
  let head: { status: number; statusText: string; headers: [string, string][]; tries?: number };
  const ending = (opened: Uint8Array) => {
    const end = JSON.parse(new TextDecoder().decode(opened)) as { reason: string; detail?: string; ms: number };
    call.took = end.ms;
    return end;
  };
  try {
    const hello = await frames.next();
    if (hello.done) return { kind: 'app', code: 'stream-lost' };
    open = await streamOpener(call.id, call.key, hello.value.body);
    let sealed = await frames.next();
    while (!sealed.done && sealed.value.type === WAIT && (await open(sealed.value.type, sealed.value.seq, sealed.value.body))) {
      call.retrying?.();
      sealed = await frames.next();
    }
    const opened = !sealed.done && (sealed.value.type === HEAD || sealed.value.type === END) ? await open(sealed.value.type, sealed.value.seq, sealed.value.body) : null;
    if (!opened) return { kind: 'app', code: 'stream-lost' };
    // A call ends before its head only while a try waits to be sent again: stopped, or cut at its time.
    if (sealed.value!.type === END) return ending(opened).reason === 'stopped' ? { kind: 'stopped' } : { kind: 'app', code: 'stream-lost' };
    head = JSON.parse(new TextDecoder().decode(opened)) as typeof head;
    call.tries = head.tries;
  } catch {
    return lost(signal);
  }
  const lostStream = new Error('The server lost this call before it ended.');
  const data = new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const frame = await frames.next();
      const opened = !frame.done && (await open(frame.value.type, frame.value.seq, frame.value.body));
      if (frame.done || !opened) return controller.error(lostStream);
      if (frame.value.type === DATA) return controller.enqueue(opened);
      if (frame.value.type !== END) return controller.error(lostStream);
      const end = ending(opened);
      if (end.reason === 'network') controller.error(new Error(end.detail));
      else controller.close();
    },
    cancel: () => void frames.return(undefined),
  });
  return sourced(new Response(NO_BODY.has(head.status) ? null : data, { status: head.status, statusText: head.statusText, headers: head.headers }));
}

// A connection that breaks while the page still wants the call (a phone putting the tab to sleep, a network change)
// is read again from the frame after the last one.
async function* framesOf(id: string, first: ReadableStream<Uint8Array>, signal: AbortSignal) {
  let body = first;
  let next = 0;
  for (let tries = 0; ; tries++) {
    try {
      for await (const frame of split(body)) {
        if (frame.type === PING) continue;
        if (frame.seq !== 0 && frame.seq < next) continue;
        if (frame.seq === 0 && next > 0) continue;
        next = frame.seq + 1;
        tries = 0;
        yield frame;
      }
      return;
    } catch (error) {
      if (signal.aborted) throw error;
    }
    const again = await reach(id, next, tries, signal);
    if (!(again instanceof ReadableStream)) return;
    body = again;
  }
}

// Two pings missed: the connection died without saying so (a sleeping device, a changed network), and its read would
// never end. Read as a broken body, so framesOf reaches the call again.
const SILENT_MS = 2 * PING_MS + 10_000;

async function* split(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  let silent: ReturnType<typeof setTimeout> | undefined;
  try {
    for (;;) {
      while (buffer.byteLength >= 4) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const length = view.getUint32(0);
        if (buffer.byteLength < 4 + length) break;
        yield { type: view.getUint8(4), seq: view.getUint32(5), body: buffer.slice(9, 4 + length) };
        buffer = buffer.slice(4 + length);
      }
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, fail) => { silent = setTimeout(() => fail(new Error('The stream went silent.')), SILENT_MS); }),
      ]);
      clearTimeout(silent);
      if (done) return;
      const joined = new Uint8Array(buffer.byteLength + value.byteLength);
      joined.set(buffer);
      joined.set(value, buffer.byteLength);
      buffer = joined;
    }
  } finally {
    clearTimeout(silent);
    void discardBody(reader);
  }
}
