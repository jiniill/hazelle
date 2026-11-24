import { afterEach, expect, it, vi } from 'vitest';
import type { DecideQuestion, Model } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { decideModel, type Route } from './assignment';
import { Credentials } from './credential';
import { decide } from './decide';
import { testLog } from '../testing';

const model: Model = { id: 'gemini-decision-1', name: 'Gemini Decision 1', input: null, output: ['decision'], contextLength: 262144, maxOutput: 1, reasoning: false, tools: null, protocol: null, takes: { settings: null, reasoning: null } };
const connection: Stored<'connection'> = { id: 'c', kind: 'connection', parent: null, rev: 1, value: { type: 'google', label: 'Google', baseUrl: null, protocol: null, accounts: [{ id: 'a', secret: 'AIza' }], turns: null, starred: [model] } };
const route: Route = { connection, model };
const chat = crypto.randomUUID();
const live = new AbortController().signal;
const questions: Record<string, DecideQuestion> = { present: { type: 'noul', instructions: 'Is Mira here?' } };
const answered = { answers: { present: { type: 'noul', noul: 0.99, confidence: 0.99 } }, usage: { total_input_tokens: 100, total_output_tokens: 0 } };
const upstream = (body: unknown, status = 200, relay: string | null = 'upstream') => vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json(body, { status, headers: relay ? { 'x-relay': relay } : {} }));

afterEach(() => vi.unstubAllGlobals());

it('asks once in the chat’s bot calls, and keeps a receipt and a log entry holding the answer as it came', async () => {
  const fetch = upstream(answered);
  vi.stubGlobal('fetch', fetch);
  const log = testLog();
  const { answer, receipt } = await decide({ credentials: new Credentials(), log }, route, '비 오는 밤.', questions, chat, live);
  expect(answer).toEqual({ ok: true, model: 'gemini-decision-1', answers: { present: { type: 'noul', noul: 0.99 } } });
  expect(receipt).toMatchObject({ connection: 'c', account: 'a', model: 'gemini-decision-1', state: 'done', error: null, usage: { inputTokens: 100, outputTokens: 0 }, cost: null });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe('/api/relay');
  expect((init.headers as Record<string, string>)['x-hazelle-bot']).toBe(chat);
  expect(JSON.parse(init.body as string)).toMatchObject({ url: 'https://generativelanguage.googleapis.com/v1beta/decisions', headers: { 'x-goog-api-key': 'AIza' } });
  expect(log.of(chat).entries).toEqual([expect.objectContaining({ purpose: 'script', receipt, request: { url: 'https://generativelanguage.googleapis.com/v1beta/decisions', body: expect.stringContaining('비 오는 밤.') }, response: JSON.stringify(answered) })]);
});

it('answers flood with no receipt, and fails with a failed receipt on a refusal or an answer short of a question', async () => {
  const deps = () => ({ credentials: new Credentials(), log: testLog() });
  vi.stubGlobal('fetch', upstream({ error: 'too-many-bot-calls' }, 429, null));
  expect(await decide(deps(), route, 'x', questions, chat, live)).toEqual({ answer: { ok: false, reason: 'flood' }, receipt: null });
  vi.stubGlobal('fetch', upstream({ error: { message: 'bad', code: 'invalid_request' } }, 400));
  expect(await decide(deps(), route, 'x', questions, chat, live)).toMatchObject({ answer: { ok: false, reason: 'failed' }, receipt: { state: 'failed', error: { kind: 'provider', status: 400 } } });
  vi.stubGlobal('fetch', upstream({ answers: {} }));
  expect(await decide(deps(), route, 'x', questions, chat, live)).toMatchObject({ answer: { ok: false, reason: 'failed' }, receipt: { state: 'failed', error: { kind: 'bad-event' } } });
});

it('takes 결정 모델 from 공용 alone, and counts one whose connection serves no decisions as gone, before any network call', async () => {
  const vertex: Stored<'connection'> = { ...connection, id: 'v', value: { ...connection.value, type: 'openai' } };
  const store = (picked?: { connection: string; model: string }) => ({
    get: ((kind: string, id: string) => (kind === 'settings' ? { value: { models: { main: { connection: 'c', model: model.id }, ...(picked && { decide: picked }) } } } : [connection, vertex].find((each) => each.id === id))) as never,
  });
  expect(decideModel(store())).toEqual({ kind: 'no-model' });
  expect(decideModel(store({ connection: 'c', model: model.id }))).toMatchObject({ connection: { id: 'c' }, model: { id: model.id } });
  expect(decideModel(store({ connection: 'v', model: model.id }))).toEqual({ kind: 'model-gone' });
  const fetch = upstream({});
  vi.stubGlobal('fetch', fetch);
  expect(await decide({ credentials: new Credentials(), log: testLog() }, { connection: vertex, model }, 'x', questions, chat, live)).toEqual({ answer: { ok: false, reason: 'failed' }, receipt: null });
  expect(fetch).not.toHaveBeenCalled();
});
