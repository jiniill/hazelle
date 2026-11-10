import { expect, it, vi } from 'vitest';
import { countTokens } from 'gpt-tokenizer/encoding/o200k_base';
import { fold, shown, type Receipt } from '../../model/chat';
import { chatModel } from './assignment';
import { appendUserMessage, startChat } from '../chat/chat-log';
import { Calibration } from '../../engine/token-calibration';
import { gather, generate } from './generate';
import { newCall, pageCall } from './streams';
import { tokenLimits } from '../chat/chat-context';
import { FIRST_PROFILE_ID, setProfileSettings } from './profiles';
import type { Session } from '../session';
import { answerable, testServer, stubRelay, upstream } from '../testing';
import { takeTurn } from '../chat/turn';
import { receiptRow } from './usage';

const server = testServer();
const signal = () => new AbortController().signal;

async function ready(session: Session, context: number | null = null) {
  await answerable(session);
  const connection = session.store.list('connection')[0]!;
  await session.store.update('connection', connection.id, (value) => ({ ...value, starred: value.starred.map((model) => ({ ...model, contextLength: context, maxOutput: 16 })) }));
  await setProfileSettings(session.store, FIRST_PROFILE_ID, { maxOutput: 16 });
  const prompt = await session.store.create('prompt', { name: 'test', toggles: [], models: {}, authorNote: '', blocks: [{ id: 'chat', kind: 'slot', slot: 'chat', range: { from: 0, to: null }, name: null }] });
  if (!prompt.ok) throw new Error(prompt.error);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {}, prompt: prompt.data.id }, null);
  for (let i = 0; i < 8; i++) await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: `${i}: ${'story '.repeat(100)}` });
  return { chat, route: chatModel(session.store, session.store.get('chat', chat)!.value, 'main') };
}

const measuredReply = (input: number) => upstream(200, { choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: input, completion_tokens: 1 } });

it('silently retries a context refusal with a smaller exact-wire cut, runs request scripts once and records one receipt', () => server.withSession(async (session) => {
  const { chat } = await ready(session);
  const requesting = vi.spyOn(session.scriptTurns, 'requesting');
  let attempts = 0;
  const log = stubRelay(({ body }) => {
    const request = JSON.parse(body!) as { messages: { content: string }[] };
    const input = request.messages.reduce((sum, { content }) => sum + countTokens(content), 0);
    return attempts++ === 0 ? upstream(400, { error: { code: 'context_length_exceeded', message: 'maximum context length exceeded' } }) : measuredReply(input * 2);
  });
  expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
  expect(log).toHaveLength(2);
  expect(requesting).toHaveBeenCalledTimes(1);
  const texts = log.map(({ sent }) => JSON.parse(sent.body!) as { messages: { content: string }[] });
  expect(texts[1]!.messages.length).toBeLessThan(texts[0]!.messages.length);
  expect(texts[1]!.messages.at(-1)).toEqual(texts[0]!.messages.at(-1));
  const receipt = shown(fold(session.store.children('entry', chat)).at(-1)!).receipt!;
  const read = await session.usage.read(signal());
  expect(read.ok && read.data.length).toBe(1);
  expect(session.tokens.call(receipt)).toMatchObject({ ratio: 2, bound: 'refusal', retries: [{ actual: null }] });
  expect(receipt.calibration!.eligible).toBe(true);
  expect(session.log.entry(chat, receipt.id)!.prompt!.messages).toEqual(texts[1]!.messages.map(({ content }) => expect.objectContaining({ content })));
}));

it('caps automatic refusal retries and keeps their evidence out of receipt usage totals', () => server.withSession(async (session) => {
  const { chat } = await ready(session);
  const log = stubRelay(() => upstream(400, { error: { code: 'context_length_exceeded', message: 'maximum context length exceeded' } }));
  expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
  expect(log).toHaveLength(3);
  const receipt = shown(fold(session.store.children('entry', chat)).at(-1)!).receipt!;
  expect(receipt).toMatchObject({ state: 'failed', usage: null, calibration: { refusal: { actual: null, maximum: null }, retries: [{ actual: null }, { actual: null }] } });
  const read = await session.usage.read(signal());
  expect(read).toMatchObject({ ok: true, data: [] });
  expect(session.usage.calibrationRows()).toHaveLength(1);
}));

it('replays late ledger observations, deduplicates a copied call, separates auxiliary routes and does not hide an unreadable ledger', () => server.withSession(async (session) => {
  const { chat, route } = await ready(session, 2000);
  if ('kind' in route) throw new Error(route.kind);
  stubRelay(() => measuredReply(1000));
  await takeTurn(session, chat, { kind: 'answer' });
  const receipt = shown(fold(session.store.children('entry', chat)).at(-1)!).receipt!;
  const settings = { maxOutput: 16 };
  const snapshot = () => session.tokens.snapshot(route, settings, tokenLimits(route.model, settings), 'conversation', chat, signal());
  const first = await snapshot();
  if (!first.ok) throw new Error(first.error);
  expect(first.data.fit).toMatchObject({ source: 'chat', bound: 'hard-upper' });
  const mass = first.data.fit.evidence;
  await session.store.batch([receiptRow(receipt, Date.now(), { chat: 'copied-chat', character: null })]);
  const duplicate = await snapshot();
  expect(duplicate.ok && duplicate.data.fit.evidence).toBeCloseTo(mass, 5);
  const measurement = receipt.calibration!.measurement;
  if (measurement.kind !== 'measured') throw new Error('unmeasured');
  const translated = await session.tokens.snapshot(route, settings, tokenLimits(route.model, settings), 'translation', chat, signal());
  if (!translated.ok) throw new Error(translated.error);
  expect(translated.data.fit.source).toBe('prior');
  const auxiliary: Receipt = { ...receipt, id: crypto.randomUUID(), calibration: { ...receipt.calibration!, measurement: { ...measurement, key: translated.data.key, at: measurement.at - 1000 } } };
  await session.store.batch([receiptRow(auxiliary, Date.now(), { chat, character: null })]);
  const apart = await snapshot();
  expect(apart.ok && apart.data.fit.evidence).toBeCloseTo(mass, 5);
  const learned = await session.tokens.snapshot(route, settings, tokenLimits(route.model, settings), 'translation', chat, signal());
  expect(learned.ok && learned.data.fit.source).toBe('chat');
  const otherRoute = { ...route, model: { ...route.model, id: 'other-model' } };
  const other = await session.tokens.snapshot(otherRoute, settings, tokenLimits(otherRoute.model, settings), 'translation', chat, signal());
  expect(other.ok && other.data.fit.source).toBe('prior');
  const earlier: Receipt = { ...receipt, id: crypto.randomUUID(), calibration: { ...receipt.calibration!, measurement: { ...measurement, fingerprint: 'earlier', at: measurement.at - 500 } } };
  await session.store.batch([receiptRow(earlier, Date.now(), { chat, character: null })]);
  const late = await snapshot();
  expect(late.ok && late.data.fit.evidence).toBeGreaterThan(mass);
  vi.spyOn(session.usage, 'read').mockResolvedValueOnce({ ok: false, error: 'unreadable' });
  expect(await snapshot()).toMatchObject({ ok: false, error: 'unreadable' });
}));

it('uses the calibrated allowance after scripts and refuses an untrimmable fixed prompt before any network call', () => server.withSession(async (session) => {
  const { chat } = await ready(session, 200);
  vi.spyOn(session.scriptTurns, 'requesting').mockImplementation(async () => ({ messages: [{ role: 'system', content: 'fixed '.repeat(400) }], writes: [] }));
  const log = stubRelay(() => measuredReply(100));
  expect(await takeTurn(session, chat, { kind: 'answer' })).toMatchObject({ kind: 'too-long' });
  expect(log).toHaveLength(0);
}));


it('learns an explicit Anthropic refusal count on its actual route before retrying, without a refused receipt', () => server.withSession(async (session) => {
  const { chat } = await ready(session, 1000);
  const connection = session.store.list('connection')[0]!;
  await session.store.update('connection', connection.id, (value) => ({ ...value, type: 'generic', baseUrl: 'https://example.test', protocol: 'anthropic-messages' }));
  let attempts = 0;
  const log = stubRelay(({ body }) => {
    const request = JSON.parse(body!) as { messages: { content: string }[] };
    const input = request.messages.reduce((sum, { content }) => sum + countTokens(content), 0) * 2;
    return attempts++ === 0 ? upstream(400, { type: 'error', error: { type: 'invalid_request_error', message: `prompt is too long: ${input} tokens > 1000 maximum` } }) : upstream(200, { type: 'message', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: input, output_tokens: 1 } });
  });
  expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
  expect(log).toHaveLength(2);
  const receipt = shown(fold(session.store.children('entry', chat)).at(-1)!).receipt!;
  expect(receipt.calibration).toMatchObject({ eligible: true, fit: { source: 'chat', bound: 'hard-upper' }, retries: [{ maximum: 1000 }] });
  expect(receipt.calibration!.retries[0]!.actual).toBeGreaterThan(1000);
  const read = await session.usage.read(signal());
  expect(read.ok && read.data).toHaveLength(1);
}));


it.each(['translation', 'memory', 'illustration', 'likeness', 'script'] as const)('preflights %s calls before credentials or the network, without trimming task messages', (requestClass) => server.withSession(async (session) => {
  const { chat, route } = await ready(session, 200);
  if ('kind' in route) throw new Error(route.kind);
  const call = requestClass === 'translation' || requestClass === 'memory'
    ? await newCall(session, route, { id: crypto.randomUUID(), chat, result: crypto.randomUUID(), for: requestClass === 'translation' ? { kind: 'input', typed: 'hello', language: 'Korean' } : { kind: 'memory', sources: [], print: '' } })
    : await pageCall(session, route, requestClass, chat);
  const messages = [{ role: 'user' as const, content: 'oversized '.repeat(500) }];
  const pick = vi.spyOn(session.credentials.pool, 'pick');
  const log = stubRelay(() => measuredReply(100));
  const answer = await generate({ credentials: session.credentials, log: session.log, connection: route.connection.value, model: route.model, settings: { maxOutput: 16 }, retries: 0, messages, call, signal: signal(), onText: gather() });
  expect(answer.error).toEqual({ kind: 'refused', code: 'context-fit' });
  expect(answer.calibration.fit?.allowance).toBeLessThan(184);
  expect(answer.calibration.measurement).toMatchObject({ kind: 'measured', key: expect.stringContaining(requestClass) });
  expect(messages[0]!.content).toBe('oversized '.repeat(500));
  expect(pick).not.toHaveBeenCalled();
  expect(log).toHaveLength(0);
}));

it('surfaces an auxiliary snapshot failure and records a provider refusal without a shrink-and-retry', () => server.withSession(async (session) => {
  const { chat, route } = await ready(session);
  if ('kind' in route) throw new Error(route.kind);
  const log = stubRelay(() => upstream(400, { error: { code: 'context_length_exceeded', message: 'maximum context length exceeded' } }));
  const ask = async () => generate({ credentials: session.credentials, log: session.log, connection: route.connection.value, model: route.model, settings: { maxOutput: 16 }, retries: 0, messages: [{ role: 'user', content: 'hello' }], call: await pageCall(session, route, 'script', chat), signal: signal(), onText: gather() });
  vi.spyOn(session.usage, 'read').mockResolvedValueOnce({ ok: false, error: 'unreadable' });
  expect((await ask()).error).toEqual({ kind: 'app', code: 'unreadable' });
  expect(log).toHaveLength(0);
  const answer = await ask();
  expect(answer).toMatchObject({ state: 'failed', usage: null, calibration: { refusal: { actual: null, maximum: null }, retries: [] } });
  expect(log).toHaveLength(1);
}));

it('reuses ledger projections and never replays observations for unchanged snapshots', () => server.withSession(async (session) => {
  const { chat, route } = await ready(session, 2000);
  if ('kind' in route) throw new Error(route.kind);
  stubRelay(() => measuredReply(1000));
  await takeTurn(session, chat, { kind: 'answer' });
  const snapshot = () => session.tokens.snapshot(route, { maxOutput: 16 }, tokenLimits(route.model, { maxOutput: 16 }), 'conversation', chat, signal());
  const first = await snapshot();
  const rows = session.usage.calibrationRows();
  const read = await session.usage.read(signal());
  const observe = vi.spyOn(Calibration.prototype, 'observe');
  const repeated = await snapshot();
  expect(first.ok && repeated.ok && repeated.data.fit.allowance).toBe(first.ok && first.data.fit.allowance);
  expect(session.usage.calibrationRows()).toBe(rows);
  const again = await session.usage.read(signal());
  expect(read.ok && again.ok && again.data).toBe(read.ok && read.data);
  expect(observe).not.toHaveBeenCalled();
}));


it('keeps an auxiliary preflight cancellation a stopped cut and reports an unresolved snapshot route', () => server.withSession(async (session) => {
  const { chat, route } = await ready(session);
  if ('kind' in route) throw new Error(route.kind);
  const log = stubRelay(() => measuredReply(100));
  const stopped = new AbortController();
  stopped.abort();
  const call = await pageCall(session, route, 'script', chat);
  const answer = await generate({ credentials: session.credentials, log: session.log, connection: route.connection.value, model: route.model, settings: { maxOutput: 16 }, retries: 0, messages: [{ role: 'user', content: 'hello' }], call, signal: stopped.signal, onText: gather() });
  expect(answer).toMatchObject({ state: 'cut', cut: 'stopped', error: null });
  expect(log).toHaveLength(0);
  const gone = { ...route, connection: { ...route.connection, value: { ...route.connection.value, type: 'missing-provider' } } };
  expect(await session.tokens.snapshot(gone, {}, tokenLimits(route.model, {}), 'script', chat, signal())).toEqual({ ok: false, error: 'calibration-route' });
}));
