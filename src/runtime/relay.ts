import type { ModelSettings } from '../connectors/settings';
import type { ApiResult } from './api';
import type { PreparedChat } from '../connectors/preparation';
import type { CallCalibration, InputMeasurement, TokenFit } from '../model/token-calibration';
import { BOT_HEADER, RELAY_HEADER } from '../contracts/http';
import { HEAD, DATA, END, PING, WAIT, retryWait, type Retry } from '../contracts/streams';
import { providerCode, providerMessage } from '../connectors/errors';
import { isRecord } from '../connectors/values';
import type { ConnectionType, HttpRequest } from '../connectors/types';
import type { PulseLabel } from '../contracts/pulse';
import { streamOpener } from '../vault/streams';
import { fetchApi } from './api';
import { pause } from './pause';
import { CONNECTION_TYPES } from '../connectors/registry';

// Whose refusal it was decides what the user is told: the provider's answer, the relay's
// own refusal (X-Relay: error), the app's (no X-Relay header, such as an expired session), or no
// connection at all. code: the provider's own name for its refusal, where its body gives one; retryAfter: its
// Retry-After header.
export type RelayFailure =
  | { kind: 'provider'; status: number; detail: string; code?: string; retryAfter?: string }
  | { kind: 'relay'; code: string }
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
};

export const accountTransport: Transport = { detached: true, problem: () => null, close: () => {}, raw: accountRaw, stream: accountStream, stop: (id) => accountStop(id), drop: (id) => accountDrop(id) };

// Like api's held account, the one open session owns the page's provider transport. Never infer it from cookies.
let transport = accountTransport;
export const holdTransport = (held: Transport) => { transport = held; };
export const detachedReplies = () => transport.detached;
export const transportProblem = (type: ConnectionType | null | undefined) => transport.problem(type);
export const relayRaw = (request: HttpRequest, signal?: AbortSignal, bot?: string, pulse?: PulseLabel, type?: ConnectionType | null) => transport.raw(request, signal, bot, pulse, type);
export const stream = (call: StreamCall, request: HttpRequest | null, signal: AbortSignal, retry: Retry | null = null, pulse?: PulseLabel, type?: ConnectionType | null) => transport.stream(call, request, signal, retry, pulse, type);
export const stopStream = (id: string) => transport.stop(id);
export const dropStream = (id: string) => transport.drop(id);

// The operator's daily 손님 응답 (server/visits.ts): a guest's reply never passes the server, so its browser says so.
const countGuestReply = (guest: string) =>
  void fetchApi('visits/guest', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ guest }) }).catch(() => {});

export function directTransport(guest: string): Transport {
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
      if (response.ok && pulse?.kind === 'call' && pulse.role === 'chat' && !closing.signal.aborted) countGuestReply(guest);
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
        const retryAfter = response instanceof Response ? response.headers.get('retry-after') : null;
        const again = response instanceof Response ? retry?.statuses.includes(response.status) : response.kind === 'offline';
        const wait = again && retry && tries <= retry.times ? retryWait(tries, retryAfter, Date.now()) : null;
        if (wait === null) {
          if (response instanceof Response && response.ok && pulse?.kind === 'call' && pulse.role === 'chat' && !closing.signal.aborted) countGuestReply(guest);
          return answered(response);
        }
        if (response instanceof Response) await response.body?.cancel();
        call.retrying?.();
        if (!(await pause(wait, canceled))) return { kind: 'stopped' };
      }
    },
    stop: (id) => { calls.get(id)?.abort(); calls.delete(id); },
    drop: (id) => { calls.delete(id); },
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
  if (source === 'upstream') return response;
  const code = await errorCode(response);
  return source === 'error' ? { kind: 'relay', code } : { kind: 'app', code };
}

async function errorCode(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  return isRecord(body) && typeof body.error === 'string' ? body.error : 'server-error';
}

async function answered(response: Response | RelayFailure): Promise<Response | RelayFailure> {
  if (!(response instanceof Response) || response.ok) return response;
  const text = await response.text().catch(() => '');
  const code = providerCode(text);
  const retryAfter = response.headers.get('retry-after');
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

// A generation call through server/stream-box (tech-spec §6, Detached replies), which goes on when this
// page stops reading. With a request it starts the call; without one it reads the call already started, from the
// start. key: the call's private key; public: its public half, to start.
// started: told once the server holds the call, before any of it is read, or once a discount lane's batch does (its
// id, runtime/generate). retrying: told each time a try failed and is to be sent again (Retry). bot: the chat whose
// bot's script makes the call, which the server limits per chat. tries: how many times the server sent it, once its
// head has been read. took: how long the call ran, as the server measured it, once its end has been read.
export type StreamCall = { preflight?: (settings: ModelSettings, signal: AbortSignal) => Promise<ApiResult<TokenFit>>; calibration?: CallCalibration; measure?: (prepared: PreparedChat) => Promise<InputMeasurement>; id: string; key: JsonWebKey; public?: string; started?: (batch?: string) => void; retrying?: () => void; bot?: string; took?: number; tries?: number };

// A read ends only at the call's own end: the end the server read, a call the server lost, or one it no longer holds
// (stream-gone); or once the session is gone (no-session), when no read can reach it. This page's other failures to
// reach it are tried again until the page stops reading; failing the read on them would save that failure as the
// call's result and drop a call still running.
// retry: how the server sends again a try that failed before any of it came, absent for none. pulse: the start's label
// (relayRaw); a read of a call already started carries none, since its start counted it.
async function accountStream(call: StreamCall, request: HttpRequest | null, signal: AbortSignal, retry: Retry | null = null, pulse?: PulseLabel): Promise<Response | RelayFailure> {
  let body: ReadableStream<Uint8Array>;
  if (request) {
    let response: Response;
    try {
      response = await fetchApi(`streams/${call.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: call.public, request, ...(call.bot && { bot: call.bot }), ...(retry && { retry }) }), signal, pulse });
    } catch {
      return lost(signal);
    }
    if (response.headers.get('x-stream') !== 'frames' || !response.body) return sourced(response);
    // A call stopped as its start was answered gets no marker: whoever stopped it ends it, and a marker landing after
    // that end would be picked up as a call to save.
    if (signal.aborted) return lost(signal);
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

// 멈추기: the call ends and the server keeps what came. A refused stop leaves the call running until it is dropped.
const accountStop = (id: string) => void fetchApi(`streams/${id}/stop`, { method: 'POST', headers: { 'content-type': 'application/json' } }).catch(() => {});

// Once the call's result is saved. A refused drop leaves the server's copy until it expires on its own.
const accountDrop = (id: string) => void fetchApi(`streams/${id}`, { method: 'DELETE', headers: { 'content-type': 'application/json' } }).catch(() => {});

// No connection or a server error are this page's and are tried again, ever more slowly; stream-gone: the server
// holds no such call; no-session: the session is gone. Throws once signal stops the read.
async function reach(id: string, from: number, tries: number, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | RelayFailure> {
  for (; ; tries++) {
    if (tries) await pause(Math.min(1000 * 2 ** (tries - 1), 30_000), signal);
    signal.throwIfAborted();
    const response = await fetchApi(`streams/${id}?from=${from}`, { signal }).catch(() => null);
    if (response?.headers.get('x-stream') === 'frames' && response.body) return response.body;
    if (response?.status === 404) return { kind: 'app', code: 'stream-gone' };
    if (response?.status === 401) return { kind: 'app', code: await errorCode(response) };
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

async function* split(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  try {
    for (;;) {
      while (buffer.byteLength >= 4) {
        const view = new DataView(buffer.buffer, buffer.byteOffset);
        const length = view.getUint32(0);
        if (buffer.byteLength < 4 + length) break;
        yield { type: view.getUint8(4), seq: view.getUint32(5), body: buffer.slice(9, 4 + length) };
        buffer = buffer.slice(4 + length);
      }
      const { done, value } = await reader.read();
      if (done) return;
      const joined = new Uint8Array(buffer.byteLength + value.byteLength);
      joined.set(buffer);
      joined.set(value, buffer.byteLength);
      buffer = joined;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
}
