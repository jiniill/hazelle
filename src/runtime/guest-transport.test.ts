import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { bareModel } from '../connectors/chat-completions';
import { CONNECTION_TYPES, catalogRequest, resolveConnection } from '../connectors/registry';
import type { Connection } from '../connectors/types';
import { fold, shown } from '../model/chat';
import { setDefaultModel } from './assignment';
import { guestAccount } from './guest-store';
import { startChat } from './chat-log';
import { Catalogs } from './catalog';
import { Credentials } from './credential';
import { accountTransport, directTransport, holdTransport, relayJson, relayRaw, stream, stopStream } from './relay';
import { autoDiagnose } from './auto-diagnosis';
import { openGuestSession, type Session } from './session';
import { FIRST_PROFILE_ID } from './profiles';
import { requestCode } from './sign-in';
import { takeTurn } from './turn';

let session: Session | undefined;
afterEach(() => {
  session?.close();
  session = undefined;
  holdTransport(accountTransport);
  vi.unstubAllGlobals();
});

const connection = (type: string): Connection => ({ type, label: type, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'test-key' }], turns: null, starred: [bareModel('model')] });
const saying = () => new Response('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });

it('opens a guest session, sends a turn directly, parses and saves it in-page, and tells the app only the steps of a guest', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => {
    if (url === '/api/visits/guest') return new Response(null, { status: 204 });
    if (url !== 'https://openrouter.ai/api/v1/chat/completions') throw new Error('Unexpected request');
    await waiting;
    return saying();
  });
  vi.stubGlobal('fetch', fetch);
  const opened = await openGuestSession(new AbortController().signal);
  if (!opened.ok) throw new Error(opened.error);
  session = opened.data;
  const guest = (await guestAccount()).accountId;
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/visits/guest']);
  expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ guest, step: 'opened' });
  fetch.mockClear();
  autoDiagnose({ event: 'turn-failed', detail: 'gone' });
  expect(fetch).not.toHaveBeenCalled();
  const { store } = session;
  session.transport.connected();
  expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ guest, step: 'connected' });
  fetch.mockClear();
  const added = await store.create('connection', connection('openrouter'));
  if (!added.ok) throw new Error(added.error);
  await setDefaultModel(store, 'main', { connection: added.data.id, model: 'model' });
  const chat = crypto.randomUUID();
  const lease = store.retainChat(chat, { created: true });
  await lease.ready;
  await startChat(store, chat, { title: null, character: null, models: {} }, null);
  const turn = takeTurn(session, chat, { kind: 'send', text: 'Hi' });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(store.list('stream')).toEqual([]);
  release();
  expect(await turn).toBeNull();
  expect(fold(store.children('entry', chat)).map((message) => shown(message).text)).toEqual(['Hi', 'Hello']);
  expect(store.list('stream')).toEqual([]);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://openrouter.ai/api/v1/chat/completions', '/api/visits/guest']);
  const provider = fetch.mock.calls[0]![1];
  expect(provider).toMatchObject({ method: 'POST', credentials: 'omit', headers: { authorization: 'Bearer test-key' } });
  expect(new Headers(provider.headers).has('x-account')).toBe(false);
  expect(new Headers(provider.headers).has('x-hazelle-pulse')).toBe(false);
  expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ guest, step: 'replied' });
  lease.release();
});

it('refuses every needs-account type before catalog, token exchange, or OAuth fetch', async () => {
  holdTransport(directTransport(crypto.randomUUID()));
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const credentials = new Credentials();
  const catalogs = new Catalogs(credentials);
  for (const id of ['friendli', 'ollama', 'copilot']) {
    const type = CONNECTION_TYPES.find((type) => type.id === id)!;
    expect(await catalogs.load(connection(type.id))).toEqual({ ok: false, failure: { kind: 'app', code: 'needs-account' } });
    if (type.signIn) expect(await requestCode(type.signIn, new AbortController().signal)).toEqual({ ok: false, failure: { kind: 'app', code: 'needs-account' } });
  }
  expect(fetch).not.toHaveBeenCalled();
  catalogs.close();
  credentials.close();
});

it('adds the type’s browser headers only on direct calls and leaves unknown network failures as offline', async () => {
  const anthropic = CONNECTION_TYPES.find(({ id }) => id === 'anthropic')!;
  const request = { url: 'https://api.anthropic.com/v1/models', method: 'GET' as const, headers: { 'x-api-key': 'test-key' }, body: null };
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({}, { headers: { 'x-relay': 'upstream' } }));
  vi.stubGlobal('fetch', fetch);
  await relayRaw(request, undefined, undefined, undefined, anthropic);
  expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual(request);
  holdTransport(directTransport(crypto.randomUUID()));
  await relayRaw(request, undefined, undefined, undefined, anthropic);
  expect(fetch.mock.calls[1]).toMatchObject(['https://api.anthropic.com/v1/models', { headers: { 'x-api-key': 'test-key', 'anthropic-dangerous-direct-browser-access': 'true' } }]);
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
  expect(await relayJson({ ...request, url: 'https://custom.example/models' })).toEqual({ ok: false, failure: { kind: 'offline' } });
});

it('retries a direct stream in-page, counts it once, and aborts the provider without stream-box requests', async () => {
  holdTransport(directTransport(crypto.randomUUID()));
  let signal: AbortSignal | undefined;
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url === '/api/visits/guest') return new Response(null, { status: 204 });
    signal = init.signal!;
    return fetch.mock.calls.length === 1 ? new Response('{}', { status: 429, headers: { 'retry-after': '0' } }) : saying();
  });
  vi.stubGlobal('fetch', fetch);
  const call = { id: crypto.randomUUID(), key: {}, started: vi.fn(), retrying: vi.fn(), tries: 0 };
  const request = { url: 'https://custom.example/chat', method: 'POST' as const, headers: {}, body: '{}' };
  const response = await stream(call, request, new AbortController().signal, { times: 1, statuses: [429] }, { kind: 'call', role: 'chat', type: 'direct', model: 'model' });
  expect(response).toBeInstanceOf(Response);
  expect(call.tries).toBe(2);
  expect(call.retrying).toHaveBeenCalledOnce();
  expect(call.started).not.toHaveBeenCalled();
  stopStream(call.id);
  expect(signal?.aborted).toBe(true);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([request.url, request.url, '/api/visits/guest']);
  await relayRaw(request, undefined, undefined, { kind: 'call', role: 'aux', type: 'direct', model: 'model' });
  expect(fetch.mock.calls.map(([url]) => url).filter((url) => url === '/api/visits/guest')).toHaveLength(1);
});


it('mints a Vertex token through the browser’s existing exchange and uses it on the direct publisher request', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const secret = JSON.stringify({ type: 'service_account', project_id: 'test', client_email: 'bot@test.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token', private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der)))}\n-----END PRIVATE KEY-----` });
  holdTransport(directTransport(crypto.randomUUID()));
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (url) => url === 'https://oauth2.googleapis.com/token' ? Response.json({ access_token: 'minted', expires_in: 3600 }) : Response.json({ publisherModels: [] }));
  vi.stubGlobal('fetch', fetch);
  const resolved = resolveConnection({ ...connection('vertex'), accounts: [{ id: 'key', secret }] })!;
  const credentials = new Credentials();
  const token = await credentials.get(resolved, secret);
  expect(token).toEqual({ ok: true, credential: 'minted' });
  if (!token.ok || !resolved.codec) throw new Error('No credential or codec');
  await relayJson({ ...catalogRequest(resolved), headers: { authorization: `Bearer ${token.credential}` } }, undefined, undefined, undefined, resolved.type);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://oauth2.googleapis.com/token', 'https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=300']);
  expect(new URLSearchParams(fetch.mock.calls[0]![1].body as string).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
  credentials.close();
});


it('refuses guest batch discounts before sending because a provider batch can outlive the page', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { visibilityState: 'hidden' });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const opened = await openGuestSession(new AbortController().signal);
  if (!opened.ok) throw new Error(opened.error);
  fetch.mockClear();
  session = opened.data;
  const { store } = session;
  const model = { ...bareModel('claude'), maxOutput: 128 };
  const added = await store.create('connection', { ...connection('anthropic'), starred: [model] });
  if (!added.ok) throw new Error(added.error);
  await setDefaultModel(store, 'main', { connection: added.data.id, model: model.id });
  await store.update('profile', FIRST_PROFILE_ID, (current) => ({ ...current, settings: { discount: true } }));
  const chat = crypto.randomUUID();
  const lease = store.retainChat(chat, { created: true });
  await lease.ready;
  await startChat(store, chat, { title: null, character: null, models: {} }, null);
  await takeTurn(session, chat, { kind: 'send', text: 'Hi' });
  const reply = fold(store.children('entry', chat)).find(({ role }) => role === 'assistant');
  expect(reply && shown(reply).receipt?.error).toEqual({ kind: 'app', code: 'needs-account' });
  expect(fetch).not.toHaveBeenCalled();
  expect(store.list('stream')).toEqual([]);
  lease.release();
});
