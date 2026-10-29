import { expect, it, vi } from 'vitest';
import api from '../../tool-api/hazelle.d.ts?raw';
import { refOf } from '../../connectors/assignment';
import { sharedModel } from '../assignment';
import { answerable, saying, stubRelay, testServer, upstream } from '../testing';
import { Usage } from '../usage';
import { askEstimate, askPlugin } from './plugin-writer';

const server = testServer();
const price = { input: 1, output: 2, cacheRead: null, cacheWrite: null, tiers: [] };

it('streams one answer from the 대화 모델 and records its usage outside chats', () => server.withSession(async (session) => {
  await answerable(session);
  const route = sharedModel(session.store, 'main');
  if ('kind' in route) throw new Error(route.kind);
  const file = 'privateCurrentFile();';
  const written = '만들었어요.\n```js\nprivateNewFile();\n```';
  const sent = stubRelay(() => upstream(200, { choices: [{ message: { content: written }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  const onText = vi.fn();
  const asked = await askPlugin(session, { body: file, ask: '고쳐 줘', model: null }, new AbortController().signal, onText);
  expect(asked).toMatchObject({ ok: true, answer: { ok: true, note: '만들었어요.', body: 'privateNewFile();\n', proposed: {} }, model: refOf(route.connection.id, route.model) });
  expect(onText).toHaveBeenLastCalledWith(written);
  expect(sent).toHaveLength(1);
  const messages = JSON.parse(sent[0]!.sent.body!).messages;
  expect(messages[0].content).toContain(api);
  expect(messages[1].content).toContain(file);
  expect(messages[1].content).toMatch(/Request:\n고쳐 줘$/);
  expect(JSON.parse(sent[0]!.sent.body!).tools).toBeUndefined();
  expect(session.store.list('stream')).toEqual([]);
  const usage = new Usage(session.store);
  const rows = await usage.read(new AbortController().signal);
  expect(rows).toMatchObject({ ok: true, data: [{ chat: null, character: null, call: { usage: { inputTokens: 100, outputTokens: 50 } } }] });
  expect(rows.ok && rows.data[0]!.call.cost).toEqual(asked.ok && asked.cost);
}));

it('asks the picked model over the 대화 모델, keeps unfenced answers as notes, and refuses missing or stopped calls', () => server.withSession(async (session) => {
  expect(await askPlugin(session, { body: null, ask: '만들어 줘', model: null }, new AbortController().signal, () => {})).toEqual({ ok: false, failure: { kind: 'no-model' } });
  await answerable(session);
  const sent = stubRelay(() => saying('내용을 더 알려 줘야 해요.'));
  expect(await askPlugin(session, { body: null, ask: '만들어 줘', model: null }, new AbortController().signal, () => {})).toMatchObject({ ok: true, answer: { ok: false, note: '내용을 더 알려 줘야 해요.' }, cost: null });
  expect(sent).toHaveLength(1);
  expect(await askPlugin(session, { body: null, ask: '만들어 줘', model: null }, AbortSignal.abort(), () => {})).toEqual({ ok: false, failure: { kind: 'stopped' } });
  expect(sent).toHaveLength(1);
  const [connection] = session.store.list('connection');
  expect(await askPlugin(session, { body: null, ask: '만들어 줘', model: { connection: connection!.id, model: 'gone' } }, new AbortController().signal, () => {})).toEqual({ ok: false, failure: { kind: 'model-gone' } });
  expect(sent).toHaveLength(1);
}));

it('estimates a full-file answer from the catalog price and returns unknown without one', () => server.withSession(async (session) => {
  await answerable(session);
  const input = { body: 'wholeFile();', ask: '고쳐 줘', model: null };
  expect(await askEstimate(session, input)).toBeNull();
  const [connection] = session.store.list('connection');
  await session.store.update('connection', connection!.id, (current) => ({ ...current, starred: current.starred.map((model) => ({ ...model, price })) }));
  const counts = vi.spyOn(session.store.evaluation, 'count').mockResolvedValue([100, 20, 10, 15]);
  expect(await askEstimate(session, input)).toEqual({ unit: 'usd', amount: 0.00016, source: 'price-list' });
  expect(counts.mock.lastCall![0].at(-1)).toBe(input.body);
}));

it('runs the tests the model calls for, answers past the limit without running, and ends on its file', () => server.withSession(async (session) => {
  await answerable(session);
  const call = (id: string, code: string) => ({ id, type: 'function', function: { name: 'run_test', arguments: JSON.stringify({ code, moment: 'reply' }) } });
  const replies = [
    { choices: [{ message: { content: '', tool_calls: [call('a', 'first();'), call('b', 'second();')] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { content: '', tool_calls: [call('c', 'third();'), call('d', 'fourth();'), { id: 'e', type: 'function', function: { name: 'run_test', arguments: '{' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { content: '고쳤어요.\n```js\nfixed();\n```' }, finish_reason: 'stop' }] },
  ];
  const sent = stubRelay(() => upstream(200, replies.shift()));
  const ran: string[] = [];
  const runner = { run: async (code: string) => (ran.push(code), { moment: '응답이 저장된 뒤', ended: 'passed' as const, report: `ran ${code}` }) };
  const asked = await askPlugin(session, { body: 'old();', ask: '고쳐 줘', model: null }, new AbortController().signal, () => {}, runner);
  expect(asked).toMatchObject({ ok: true, answer: { ok: true, body: 'fixed();\n' }, steps: [{ report: 'ran first();' }, { report: 'ran second();' }, { report: 'ran third();' }] });
  expect(ran).toEqual(['first();', 'second();', 'third();']);
  expect(JSON.parse(sent[0]!.sent.body!).tools[0].function.name).toBe('run_test');
  const answers = JSON.parse(sent[2]!.sent.body!).messages.filter((message: { role: string }) => message.role === 'tool').map((message: { content: string }) => message.content);
  expect(answers).toEqual(['ran first();', 'ran second();', 'ran third();', expect.stringContaining('used up'), expect.stringContaining('arguments')]);
}));
