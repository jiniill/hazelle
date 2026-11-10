import { afterEach, expect, it, vi } from 'vitest';
import { embedRoute } from '../../connectors/registry';
import type { Model } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { embedModel, type Route } from './assignment';
import { Credentials } from './credential';
import { embedTexts } from './embed';
import { testLog } from '../testing';

const model: Model = { id: 'text-embedding-3-small', name: 'Small', input: ['text'], output: ['embedding'], contextLength: null, maxOutput: null, reasoning: null, tools: null, protocol: null, takes: { settings: null, reasoning: null }, price: { input: 0.02, output: 0, cacheRead: null, cacheWrite: null, tiers: [] } };
const connection: Stored<'connection'> = { id: 'c', kind: 'connection', parent: null, rev: 1, value: { type: 'openai', label: 'OpenAI', baseUrl: null, protocol: null, accounts: [{ id: 'a', secret: 'sk' }], turns: null, starred: [model] } };
const route: Route = { connection, model };
const chat = crypto.randomUUID();
const live = new AbortController().signal;
const deps = (tokens = 1) => ({ credentials: new Credentials(), log: testLog(), count: async (texts: string[]) => texts.map(() => tokens) });
const upstream = (body: unknown, status = 200, relay: string | null = 'upstream') => vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json(body, { status, headers: relay ? { 'x-relay': relay } : {} }));

afterEach(() => vi.unstubAllGlobals());

it('refuses too many texts or too long a text before any network call', async () => {
  const fetch = upstream({});
  vi.stubGlobal('fetch', fetch);
  expect(await embedTexts(deps(), route, Array(65).fill('밤'), null, chat, true, live)).toEqual({ answer: { ok: false, reason: 'too-large' }, receipt: null });
  expect(await embedTexts(deps(8193), route, ['밤'], null, chat, true, live)).toEqual({ answer: { ok: false, reason: 'too-large' }, receipt: null });
  expect(fetch).not.toHaveBeenCalled();
});

it('relays naming its chat and keeps a receipt with input tokens and the price-list cost', async () => {
  const fetch = upstream({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 500_000 } });
  vi.stubGlobal('fetch', fetch);
  const { answer, receipt } = await embedTexts(deps(), route, ['밤'], 'query', chat, true, live);
  expect(answer).toEqual({ ok: true, model: 'text-embedding-3-small', vectors: [[0.1, 0.2]] });
  expect(receipt).toMatchObject({ connection: 'c', account: 'a', source: 'OpenAI', model: 'text-embedding-3-small', state: 'done', error: null, usage: { inputTokens: 500_000, outputTokens: 0 }, cost: { unit: 'usd', amount: 0.01, source: 'price-list' } });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/relay');
  expect((init.headers as Record<string, string>)['x-hazelle-bot']).toBe(chat);
  expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://api.openai.com/v1/embeddings', headers: { authorization: 'Bearer sk' } });
  await embedTexts(deps(), route, ['밤'], 'query', chat, false, live);
  expect(fetch.mock.calls[1]![1].headers).not.toHaveProperty('x-hazelle-bot');
});

it('splits a call for Vertex AI into one request a text, a second apart, counted once in the bot cap, with one receipt', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const secret = JSON.stringify({ type: 'service_account', project_id: 'p', private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`, client_email: 'bot@p.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' });
  const embedder: Model = { ...model, id: 'gemini-embedding-2', price: { input: 0.2, output: 0, cacheRead: null, cacheWrite: null, tiers: [] } };
  const vertex: Route = { connection: { ...connection, value: { ...connection.value, type: 'vertex', label: 'Vertex AI', accounts: [{ id: 'a', secret }], starred: [embedder] } }, model: embedder };
  let index = 0;
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async (_url, init) => {
    const sent = JSON.parse(init.body as string) as { url: string };
    const body = sent.url.endsWith('/token') ? { access_token: 't', expires_in: 3600 } : { embedding: { values: [index++] }, usageMetadata: { promptTokenCount: 500_000 } };
    return Response.json(body, { headers: { 'x-relay': 'upstream' } });
  });
  vi.stubGlobal('fetch', fetch);
  const credentials = new Credentials();
  await credentials.get(embedRoute(vertex.connection.value, embedder)!, secret, live);
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const log = testLog();
  const embedded = vi.fn();
  const embedding = embedTexts({ ...deps(), credentials, log }, vertex, ['밤', '낮', '아침'], 'query', chat, true, live, embedded);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(embedded.mock.calls).toEqual([[1]]);
  await vi.advanceTimersByTimeAsync(1001);
  const { answer, receipt } = await embedding;
  vi.useRealTimers();
  expect(answer).toEqual({ ok: true, model: 'gemini-embedding-2', vectors: [[0], [1], [2]] });
  const embeds = fetch.mock.calls.slice(1).map(([, init]) => init);
  expect(embeds.map((init) => (init.headers as Record<string, string>)['x-hazelle-bot'])).toEqual([chat, undefined, undefined]);
  expect(receipt).toMatchObject({ state: 'done', usage: { inputTokens: 1_500_000 }, cost: { unit: 'usd', amount: expect.closeTo(0.3) } });
  const [entry] = log.of(chat).entries;
  expect(log.of(chat).entries).toHaveLength(1);
  expect(JSON.parse(entry!.request!.body!).map((body: { content: { parts: { text: string }[] } }) => body.content.parts[0]!.text)).toEqual(['task: search result | query: 밤', 'task: search result | query: 낮', 'task: search result | query: 아침']);
});

it('logs the call under its chat as an embedding, its request without the vectors that answered it', async () => {
  vi.stubGlobal('fetch', upstream({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 1 } }));
  const log = testLog();
  const { receipt } = await embedTexts({ ...deps(), log }, route, ['밤'], 'query', chat, true, live);
  expect(log.of(chat).entries).toEqual([expect.objectContaining({ purpose: 'embedding', receipt, request: { url: 'https://api.openai.com/v1/embeddings', body: expect.stringContaining('밤') }, response: null })]);
});

it('answers flood when the server refuses the chat’s bot call, with no receipt', async () => {
  vi.stubGlobal('fetch', upstream({ error: 'too-many-bot-calls' }, 429, null));
  expect(await embedTexts(deps(), route, ['밤'], null, chat, true, live)).toEqual({ answer: { ok: false, reason: 'flood' }, receipt: null });
});

it('fails with a failed receipt when the answer is not an embedding answer or the provider refuses', async () => {
  vi.stubGlobal('fetch', upstream({ data: [] }));
  const unparsed = await embedTexts(deps(), route, ['밤'], null, chat, true, live);
  expect(unparsed.answer).toEqual({ ok: false, reason: 'failed' });
  expect(unparsed.receipt).toMatchObject({ state: 'failed', error: { kind: 'bad-event' } });
  vi.stubGlobal('fetch', upstream({ error: { message: 'bad key' } }, 401));
  expect((await embedTexts(deps(), route, ['밤'], null, chat, true, live)).receipt).toMatchObject({ state: 'failed', error: { kind: 'provider', status: 401 } });
});

it('refuses a connection that serves no embeddings before the network', async () => {
  const fetch = upstream({});
  vi.stubGlobal('fetch', fetch);
  const groq: Route = { connection: { ...connection, value: { ...connection.value, type: 'groq' } }, model };
  expect(await embedTexts(deps(), groq, ['밤'], null, chat, true, live)).toEqual({ answer: { ok: false, reason: 'failed' }, receipt: null });
  expect(fetch).not.toHaveBeenCalled();
});

it('takes 임베딩 모델 from 공용 alone, and counts one whose connection serves none as gone', () => {
  const groq: Stored<'connection'> = { ...connection, id: 'g', value: { ...connection.value, type: 'groq' } };
  const store = (embed?: { connection: string; model: string }) => ({
    get: ((kind: string, id: string) => (kind === 'settings' ? { value: { models: { main: { connection: 'c', model: model.id }, ...(embed && { embed }) } } } : [connection, groq].find((each) => each.id === id))) as never,
  });
  expect(embedModel(store())).toEqual({ kind: 'no-model' });
  expect(embedModel(store({ connection: 'c', model: model.id }))).toMatchObject({ connection: { id: 'c' }, model: { id: model.id } });
  expect(embedModel(store({ connection: 'g', model: model.id }))).toEqual({ kind: 'model-gone' });
  expect(embedModel(store({ connection: 'c', model: 'unstarred' }))).toEqual({ kind: 'model-gone' });
});
