import { answerable, testServer } from './testing';
import { appendUserMessage, startChat } from './chat-log';
import { cacheSend, wouldSend } from './turn-context';
import { tokenLimits } from './chat-context';
import { describe, expect, it } from 'vitest';
import type { CacheFacts } from '../connectors/registry';
import type { Message, Receipt } from '../model/chat';
import type { Role } from '../model/prompt';
import { cacheRecurrence, cacheShortfall, shortfallPlace } from './cache-diagnosis';
import type { LogEntry } from './request-log';
import type { Connection, Model } from '../connectors/types';
import { cachePrintId, type WireMessage } from '../model/cache';
import { breakCost, forecast, lastCache, prefixKept, type CacheSend, type Prior } from './cache';

// Each message counts 10 tokens and is named by its text, which is its hash; a trailing ✓ puts a cache point after it.
const send = (texts: string[], over: { connection?: string; account?: string | null; model?: string; facts?: CacheFacts } = {}): CacheSend => ({
  connection: over.connection ?? 'c1',
  account: over.account === undefined ? 'a1' : over.account,
  model: over.model ?? 'm1',
  messages: texts.map((text) => {
    const name = text.replace(' ✓', '');
    return { role: (text.startsWith('sys') ? 'system' : 'user') as Role, hash: name, tokens: 10, from: { kind: 'block', name, slot: null }, ...(text.endsWith('✓') && { point: true as const }) };
  }),
  facts: over.facts ?? null,
});
const before = (texts: string[], live = true): Prior => {
  const { connection, account, model, messages } = send(texts);
  return { print: { call: 'call', connection, account, model, messages }, live };
};
const from = (name: string) => ({ kind: 'block', name, slot: null });

describe('forecast', () => {
  const last = before(['sys ✓', 'u1', 'a1 ✓']);

  it('names cached text moved across the first divergent wire position', () => {
    const previous = before(['sys ✓', 'm1', 'm2', 'D', 'm3 ✓']);
    const next = send(['sys ✓', 'm1', 'm2', 'm3', 'D', 'm4 ✓']);
    const depth = { kind: 'depth', id: 'D', name: 'D', depth: 1 } as const;
    for (const message of [...previous.print.messages, ...next.messages]) {
      if (message.hash === 'D') { message.from = depth; message.role = 'system'; }
      else if (message.hash.startsWith('m')) message.from = { kind: 'block', name: 'Chat', slot: 'chat' };
    }
    const made = forecast(previous, next)!;
    expect(made.against).toEqual({ read: 10, of: 50, broken: { kind: 'moved', from: depth, role: 'system' } });
    expect(made.parts.map(({ change }) => change)).toEqual([null, null, null, null, 'moved', null]);
  });

  it('names only the removal when later cached parts merely shift left', () => {
    const made = forecast(before(['sys ✓', 'm1', 'm2', 'm3', 'm4 ✓']), send(['sys ✓', 'm1', 'm3', 'm4 ✓']))!;
    expect(made.against).toEqual({ read: 10, of: 50, broken: { kind: 'removed', from: from('m2'), role: 'user' } });
    expect(made.parts.map(({ change }) => change)).toEqual([null, null, null, null]);
    expect(made.removed).toEqual([{ role: 'user', from: from('m2'), tokens: 10, before: 2 }]);
  });

  it('keeps chat as the frame even when keeping more non-chat parts would discard a chat part', () => {
    const previous = before(['sys ✓', 'm1', 'D', 'E', 'm2 ✓']);
    const next = send(['sys ✓', 'D', 'E', 'm1', 'm2 ✓']);
    for (const message of [...previous.print.messages, ...next.messages]) if (message.hash.startsWith('m')) message.from = { kind: 'block', name: 'Chat', slot: 'chat' };
    const made = forecast(previous, next)!;
    expect(made.against?.broken).toEqual({ kind: 'moved', from: from('D'), role: 'user' });
    expect(made.parts.map(({ change }) => change)).toEqual([null, 'moved', 'moved', null, null]);
  });

  it('reads all the last call cached when the next send only adds after it, and writes up to its own last point', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓', 'note']))).toMatchObject({ against: { read: 30, of: 30, broken: null }, written: 10, tail: 10, removed: [] });
  });

  it('reads nothing when another account of the connection would send it, and claims no change when the next is unknown', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { account: 'a2' }))?.against?.broken).toEqual({ kind: 'account' });
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { account: null }))?.against?.broken).toBeNull();
  });

  it('names a message put in before the cached chat, and reads up to the point before it', () => {
    expect(forecast(last, send(['sys ✓', 'lore', 'u1', 'a1 ✓', 'u2 ✓']))?.against).toEqual({ read: 10, of: 30, broken: { kind: 'added', from: from('lore'), role: 'user' } });
  });

  it('names a message the last call sent and the next drops, as the budget drops the oldest', () => {
    expect(forecast(last, send(['sys ✓', 'a1', 'u2 ✓']))?.against?.broken).toEqual({ kind: 'removed', from: from('u1'), role: 'user' });
  });

  it('reads nothing on another model, or once the time is up', () => {
    expect(forecast(last, send(['sys ✓', 'u1', 'a1 ✓'], { model: 'm2' }))?.against).toEqual({ read: 0, of: 30, broken: { kind: 'model' } });
    expect(forecast(before(['sys ✓', 'u1', 'a1 ✓'], false), send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓']))?.against?.broken).toEqual({ kind: 'expired' });
  });

  it('retains part changes when expiry is already the first reason the cache cannot be read', () => {
    const next = send(['sys ✓', 'u1', 'a1 ✓']);
    next.messages[0]!.hash = 'changed';
    const made = forecast(before(['sys ✓', 'u1', 'a1 ✓'], false), next)!;
    expect(made.against?.broken).toEqual({ kind: 'expired' });
    expect(made.parts[0]).toMatchObject({ change: 'changed', before: 0 });
  });

  it('lists every part that differs in wire order, a changed one beside what it replaces, with each part read, written or left out', () => {
    const next: CacheSend = send(['sys ✓', 'lore', 'u1', 'a1', 'u2 ✓', 'tail']);
    next.messages[0] = { ...next.messages[0]!, hash: 'sys edited' };
    const made = forecast(before(['sys ✓', 'gone', 'u1', 'a1 ✓']), next)!;
    expect(made.against).toEqual({ read: 0, of: 40, broken: { kind: 'changed', from: from('sys'), role: 'system' } });
    expect(made.parts.map(({ state, change, point }) => [state, change, point])).toEqual([
      ['write', 'changed', 'cache'],
      ['write', 'added', null],
      ['write', null, null],
      ['write', null, null],
      ['write', null, 'cache'],
      ['tail', null, null],
    ]);
    expect(made.removed).toEqual([{ role: 'user', from: from('gone'), tokens: 10, before: 1 }]);
    expect([made.written, made.tail]).toEqual([50, 10]);
  });

  it('pairs an edited chat message when it passes from the last-chat slot into a past-chat slot', () => {
    const previous = before(['sys ✓', 'old ✓']);
    previous.print.messages[1]!.from = { kind: 'block', id: 'last', name: 'Last', slot: 'chat' };
    const next = send(['sys ✓', 'edited', 'reply ✓']);
    next.messages[1]!.from = { kind: 'block', id: 'past', name: 'Past', slot: 'chat' };
    expect(forecast(previous, next)?.parts[1]).toMatchObject({ change: 'changed', before: 1 });
  });

  it('pairs a changed part with its last version though a print stored before ids were kept has none', () => {
    const next = send(['sys ✓', 'u1', 'a1 ✓']);
    next.messages = next.messages.map((message) => ({ ...message, from: { ...message.from, id: 'block' } }));
    next.messages[0] = { ...next.messages[0]!, hash: 'sys edited' };
    expect(forecast(last, next)?.against?.broken).toMatchObject({ kind: 'changed' });
  });

  it("leaves out a point under the model's minimum, and reads nothing past the provider's lookback", () => {
    const facts = { minimum: 25, lookback: 2 };
    const short = forecast(before(['sys ✓', 'u1', 'a1 ✓']), send(['sys ✓', 'u1', 'a1 ✓', 'u2 ✓'], { facts }))!;
    expect(short.against).toEqual({ read: 30, of: 30, broken: null });
    expect(short.parts[0]!.point).toBe('short');
    const far = forecast(before(['sys ✓', 'u1', 'a1 ✓']), send(['sys ✓', 'u1', 'a1', 'l1', 'l2', 'u2 ✓'], { facts }))!;
    expect(far.against).toEqual({ read: 0, of: 30, broken: { kind: 'far' } });
  });
});

describe('forecast without points', () => {
  // 누렁이Gemini v14.2 as Gemini sends it, every system message first: 장기 기억 above the chat, then 과거 챗 · 마지막 챗,
  // 추가 정보 · 유저 인풋, 현재 챗, 응답템플릿.
  const memory = { kind: 'block', name: '장기 기억', slot: 'memory' } as const;
  const nureongi = (summary: string, chat: string[]) => {
    const made = send(['sys 개요', `sys ${summary}`, '가이드라인', ...chat.slice(0, -1), '추가 정보', '유저 인풋', chat.at(-1)!, '응답템플릿']);
    made.messages[1]!.from = memory;
    for (const message of made.messages) if (chat.includes(message.hash)) message.from = { kind: 'block', name: 'Chat', slot: 'chat' };
    return made;
  };
  const prior = (made: CacheSend): Prior => ({ print: { call: 'call', connection: made.connection, account: made.account, model: made.model, messages: made.messages }, live: true });
  const four = ['c1', 'c2', 'c3', 'c4'];
  const six = [...four, 'c5', 'c6'];

  it('reads all the last call sent when the send repeats it', () => {
    expect(forecast(prior(nureongi('mem1', four)), nureongi('mem1', four))).toMatchObject({ against: { read: 100, of: 100, broken: null }, written: 0, tail: 0, prefix: true });
  });

  it('names renewed memory sent above the chat, and reads only what stands before it', () => {
    const made = forecast(prior(nureongi('mem1', four)), nureongi('mem2', six))!;
    expect(made.against).toEqual({ read: 10, of: 90, broken: { kind: 'changed', from: memory, role: 'system' } });
    expect([made.written, made.tail]).toEqual([0, 110]);
  });

  it('expects the read to reach the last chat message, so parts set between chat messages count as moved', () => {
    const made = forecast(prior(nureongi('mem1', four)), nureongi('mem1', six))!;
    expect(made.against).toEqual({ read: 60, of: 90, broken: { kind: 'moved', from: from('추가 정보'), role: 'user' } });
    expect(made.parts.filter(({ change }) => change).map(({ from }) => from)).toEqual([from('추가 정보'), from('유저 인풋')]);
  });

  it('prices reading all of it as plain input, with nothing written on either side', () => {
    const made = forecast(prior(nureongi('mem1', four)), nureongi('mem2', six))!;
    const model = { id: 'm1', price: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [] } } as unknown as Model;
    const cost = breakCost({ type: 'gemini', label: '', baseUrl: null } as unknown as Connection, model, made, 1)!;
    expect(cost.paid.amount).toBeCloseTo((110 * 4 + 10 * 0.4) / 1_000_000, 12);
    expect(cost.whole.amount).toBeCloseTo((30 * 4 + 90 * 0.4) / 1_000_000, 12);
  });
});

it('prices a break in the model\'s native tokens, not the o200k counts the parts hold', () => {
  const made = forecast(before(['sys ✓', 'u1', 'a1 ✓']), send(['sys ✓', 'lore', 'u1', 'a1 ✓', 'u2 ✓']))!;
  const model = { id: 'm1', price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, tiers: [] } } as unknown as Model;
  const connection = { type: 'anthropic', label: '', baseUrl: null } as unknown as Connection;
  const o200k = breakCost(connection, model, made, 1)!;
  const native = breakCost(connection, model, made, 1.6)!;
  expect(native.paid.amount).toBeCloseTo(o200k.paid.amount * 1.6, 12);
  expect(native.whole.amount).toBeCloseTo(o200k.whole.amount * 1.6, 12);
});

describe('lastCache', () => {
  const receipt = (over: Partial<Receipt>): Receipt => ({
    id: 'call', connection: 'c1', source: 'S', model: 'm1', modelName: 'M', state: 'done', cut: null, error: null, finishReason: 'stop', cost: null, replyId: null, firstTextMs: 100,
    usage: { inputTokens: 1000, outputTokens: 10, reasoningTokens: null, cachedInputTokens: 0, cacheWriteInputTokens: 900 }, totalMs: 4000, cache: '5m', ...over,
  });
  const reply = (at: number, value: Receipt): Message => ({ id: `m${at}`, role: 'assistant', at, versions: [{ id: `v${at}`, seed: 's', text: 't', receipt: value, edited: false, at }], selected: 0 });

  it('counts the latest ten distinct reply calls from receipts, including unknown forecasts', () => {
    const messages = Array.from({ length: 12 }, (_, at) => reply(at, receipt({ id: `call-${at}`, forecast: at === 11 ? undefined : { read: 0, of: 100, broken: at === 10 ? null : at === 8 ? { kind: 'moved', from: { kind: 'depth', id: 'lore', name: 'Entry', depth: 1 }, role: 'system' } : { kind: 'changed', from: { kind: 'block', name: 'sys', slot: null }, role: 'system' } } })));
    messages[9]!.versions.push({ ...messages[9]!.versions[0]!, id: 'edited-copy', at: 20 });
    const result = cacheRecurrence(messages);
    expect(result).toMatchObject({ considered: 9, missing: 1, broken: 8 });
    expect(result.causes.map(({ cause, count }) => [cause.kind, count])).toEqual([['changed', 7], ['moved', 1]]);
  });

  it('counts provider shortfalls with the breaks and keeps the newest run of them on one connection', () => {
    const read = (at: number, connection: string, cached: number | null, broken: Receipt['forecast'] = { read: 1000, of: 1000, broken: null }) =>
      reply(at, receipt({ id: `call-${at}`, connection, forecast: broken, usage: { inputTokens: 1000, outputTokens: 10, reasoningTokens: null, cachedInputTokens: cached, cacheWriteInputTokens: null } }));
    const messages = [read(1, 'c1', 0), read(2, 'c1', 1000), read(3, 'c1', 0), read(4, 'c1', null), read(5, 'c1', 0, { read: 0, of: 1000, broken: { kind: 'expired' } }), read(6, 'c1', 100)];
    expect(cacheRecurrence(messages)).toMatchObject({ considered: 6, broken: 4, short: 3, streak: { connection: 'c1', count: 2 } });
    expect(cacheRecurrence([...messages, read(7, 'c2', 0)]).streak).toEqual({ connection: 'c2', count: 1 });
  });

  it('names the first part a shortfall left out, at the part boundary nearest the calibrated read', () => {
    const entry = { wire: [{ content: 'a', index: 1 }, { content: 'b', index: 0 }, { content: 'c', index: 2 }], prompt: { messages: [{ role: 'system' }, { role: 'system' }, { role: 'user' }], parts: [{ from: { kind: 'block', name: 'B', slot: null }, tokens: 500 }, { from: { kind: 'block', name: 'A', slot: null }, tokens: 1000 }, { from: { kind: 'block', name: 'C', slot: 'chat' }, tokens: 300 }] } } as unknown as LogEntry;
    expect(shortfallPlace(entry, { expected: 2700, actual: 2220, ratio: 1.5, short: true })?.from).toMatchObject({ name: 'C' });
    expect(shortfallPlace(entry, { expected: 2700, actual: 0, ratio: 1.5, short: true })?.from).toMatchObject({ name: 'A' });
    expect(shortfallPlace(entry, { expected: 2700, actual: 2700, ratio: 1.5, short: true })).toBeNull();
    expect(shortfallPlace({ ...entry, wire: undefined }, { expected: 2700, actual: 0, ratio: 1.5, short: true })).toBeNull();
  });

  it('compares reported cache reads in the calibrated units and does not call tokenizer noise an eviction', () => {
    const value = receipt({ forecast: { read: 1000, of: 1000, broken: null }, usage: { inputTokens: 1000, cachedInputTokens: 300, outputTokens: 10, cacheWriteInputTokens: null, reasoningTokens: null }, calibration: { eligible: true, fit: null, retries: [], measurement: { kind: 'measured', key: 'k', at: 0, fingerprint: 'f', o200k: 2000, messages: 2, blocks: 2, pictures: 0 } } });
    expect(cacheShortfall(value)).toEqual({ expected: 500, actual: 300, ratio: 0.5, short: false });
    value.usage!.cachedInputTokens = 100;
    expect(cacheShortfall(value)?.short).toBe(true);
    value.usage!.cachedInputTokens = null;
    expect(cacheShortfall(value)).toBeNull();
  });

  it('keeps what the latest call cached for its TTL from the call’s start, and nothing when it cached none', () => {
    expect(lastCache([reply(10_000, receipt({ cache: '1h' })), reply(20_000, receipt({}))])).toEqual({ call: 'call', until: 16_000 + 300_000 });
    expect(lastCache([reply(10_000, receipt({})), reply(20_000, receipt({ usage: { inputTokens: 100, outputTokens: 1, reasoningTokens: null, cachedInputTokens: 0, cacheWriteInputTokens: 0 } }))])).toBeNull();
    expect(lastCache([reply(10_000, receipt({ cache: null }))])).toEqual({ call: 'call', until: null });
  });

  it('keeps a call without points only once the provider has reported a read on that connection and model', () => {
    const chat = crypto.randomUUID();
    const store = (messages: WireMessage[] | null) => ({ children: () => (messages ? [{ id: cachePrintId(chat), value: { call: 'old', connection: 'c1', account: null, model: 'm1', messages } }] : []) }) as unknown as Parameters<typeof prefixKept>[0];
    const usage = (cached: number | null) => ({ inputTokens: 1000, outputTokens: 10, reasoningTokens: null, cachedInputTokens: cached, cacheWriteInputTokens: null });
    const plain: WireMessage[] = [{ role: 'user', hash: 'h', tokens: 10, from: { kind: 'block', name: 'u', slot: null } }];
    expect(prefixKept(store(null), chat, receipt({ cache: null, usage: usage(500) }))).toBe(true);
    expect(prefixKept(store(null), chat, receipt({ cache: null, usage: usage(null) }))).toBe(false);
    expect(prefixKept(store(plain), chat, receipt({ cache: null, usage: usage(null) }))).toBe(true);
    expect(prefixKept(store(plain), chat, receipt({ cache: null, model: 'm2', usage: usage(null) }))).toBe(false);
    expect(prefixKept(store([{ ...plain[0]!, point: true }]), chat, receipt({ cache: null, usage: usage(null) }))).toBe(false);
  });
});


const server = testServer();

it('converts the native cache minimum once with the conversation lower predictive bound', () => server.withSession(async (session) => {
  await answerable(session);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'hello' });
  const sending = await wouldSend(session, chat, { kind: 'answer' });
  if (!sending) throw new Error('not sendable');
  const original = sending.turn.route;
  sending.turn.route = { ...original, model: { ...original.model, id: 'claude-sonnet-4-5' }, connection: { ...original.connection, value: { ...original.connection.value, type: 'generic', baseUrl: 'https://example.test', protocol: 'anthropic-messages' } } };
  sending.turn.settings = { cache: '5m', maxOutput: 16 };
  const { route, settings } = sending.turn;
  const snapshot = await session.tokens.snapshot(route, settings, tokenLimits(route.model, settings), 'conversation', chat, new AbortController().signal);
  if (!snapshot.ok) throw new Error(snapshot.error);
  sending.calibration = snapshot.data;
  const threshold = Math.ceil(1024 / snapshot.data.estimate.lower);
  expect(threshold).toBeGreaterThan(1024 / snapshot.data.estimate.centre);
  sending.prompt = { messages: [{ role: 'user', content: 'prefix', cache: true }], parts: [{ tokens: threshold - 1, from: { kind: 'block', name: 'prefix', slot: null } }], lore: null, silent: null, invalidKeys: [], loreBudget: 0, memory: null, dropped: 0, problems: { found: [], omitted: 0 }, unseen: 0 };
  const short = cacheSend(sending, null)!;
  expect(short.facts?.minimum).toBe(threshold);
  expect(forecast(null, short)?.parts[0]!.point).toBe('short');
  sending.prompt.parts[0]!.tokens++;
  const reached = cacheSend(sending, null)!;
  expect(reached.facts?.minimum).toBe(threshold);
  expect(forecast(null, reached)?.parts[0]!.point).toBe('cache');
}));
