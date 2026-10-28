import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordText } from '../engine/memory';
import { RETRIEVED_HEADING } from '../engine/retrieval';
import { fold, shown } from '../model/chat';
import { emptyMemory, memoryId, vectorsId, type MemoryRecord } from '../model/memory';
import type { Session } from './session';
import * as embeddingCalls from './embed';
import { setDefaultModel } from './assignment';
import { appendUserMessage, startChat } from './chat-log';
import { chatMemory } from './memory-read';
import { setDefaultMemory } from './memory';
import { chatVectors, indexRecords, queryOf, retrievalOf } from './retrieval';
import { answerable, inTurn, saying, stubRelay, testServer, upstream } from './testing';
import { takeTurn } from './turn';

const server = testServer();
afterEach(() => vi.restoreAllMocks());

const summary = (what: string) => JSON.stringify({ records: [{ to: 1, when: null, where: 'the pier', who: ['Luna', 'jin'], what, lines: [], outcome: '', state: [], opens: [], closes: [] }] });
const embedding = (...vectors: number[][]) => upstream(200, { data: vectors.map((embedding, index) => ({ index, embedding })), usage: { prompt_tokens: vectors.length } });

describe('retrieval', () => {
  it('embeds new records at the 임베딩 모델 once summarizing is done, and a send puts the nearest records before its latest message', () =>
    server.withSession(async (session) => {
      await answerable(session);
      const connection = session.store.list('connection')[0]!.id;
      await setDefaultModel(session.store, 'embed', { connection, model: 'm' });
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const texts = ['We meet at the pier.', 'Luna shows me the lamp.', 'We walk to the lighthouse.', 'Luna names the boats.'];
      for (const text of texts) await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text });
      // One job a message past the window; then one embedding call for the four records.
      const log = stubRelay(inTurn([saying('Luna waves.'), ...texts.map((text) => saying(summary(text))), embedding([1, 0, 0], [0, 1, 0], [0, 0, 1], [0.7, 0.7, 0])]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(4));
      await vi.waitFor(() => expect(Object.keys(chatVectors(session.store, chat)?.value.items ?? {})).toHaveLength(4));
      const records = chatMemory(session.store, chat).records;
      const vectors = chatVectors(session.store, chat)!;
      expect(vectors.parent).toBe(chat);
      expect(vectors.value.model).toBe('m');
      records.forEach((record) => expect(vectors.value.items[record.id]).toMatchObject({ at: record.at }));
      expect(log).toHaveLength(6);
      expect(log[5]!.sent.url).toContain('/embeddings');
      expect(JSON.parse(log[5]!.sent.body as string)).toMatchObject({ model: 'm', input: records.map(recordText) });
      await vi.waitFor(() => expect(session.memory.snapshot().indexing.size).toBe(0));

      // The query embeds nearest the first and the fourth record; the two messages past the window are summarized after
      // the reply, and the two new records embedded in one call.
      const again = stubRelay(inTurn([embedding([1, 0, 0]), saying('Luna smiles.'), saying(summary('Luna waves at jin.')), saying(summary('jin asks about the pier.')), embedding([0, 0, 1], [0, 1, 0])]));
      expect(await takeTurn(session, chat, { kind: 'send', text: 'Do you remember the pier, Luna? Tell me what we said there that morning.' })).toBeNull();
      expect(again[0]!.sent.url).toContain('/embeddings');
      expect(JSON.parse(again[0]!.sent.body as string)).toMatchObject({ input: ['Do you remember the pier, Luna? Tell me what we said there that morning.'] });
      const reply = fold(session.store.children('entry', chat)).at(-1)!;
      const sent = { prompt: session.log.entry(chat, shown(reply).receipt!.id)!.prompt! };
      expect(sent.prompt.memory).toMatchObject({ by: null, found: [records[0]!.id, records[3]!.id] });
      const at = sent.prompt.messages.findIndex(({ content }) => content.startsWith(RETRIEVED_HEADING));
      expect(sent.prompt.messages[at]).toMatchObject({ role: 'user' });
      expect(sent.prompt.messages[at]!.content).toContain(`The messages, word for word:\njin: ${texts[0]}`);
      expect(sent.prompt.messages[at]!.content).toContain(`The messages, word for word:\njin: ${texts[3]}`);
      expect(sent.prompt.messages[at + 1]!.content).toBe('Do you remember the pier, Luna? Tell me what we said there that morning.');
      await vi.waitFor(() => expect(Object.keys(chatVectors(session.store, chat)?.value.items ?? {})).toHaveLength(6));
      expect(again).toHaveLength(5);
    }));

  it('asks with the latest user message, and under forty characters with the end of the reply before it', () => {
    const message = (role: 'user' | 'assistant', text: string) => ({ id: text, message: text, seed: text, role, text, time: null });
    expect(queryOf([message('assistant', 'Luna waits at the pier for the boats to come in.'), message('user', 'Do you remember the pier, Luna? Tell me what we said there.')])).toBe('Do you remember the pier, Luna? Tell me what we said there.');
    expect(queryOf([message('assistant', 'Luna waits at the pier for the boats to come in.'), message('user', '그래서?')])).toBe('Luna waits at the pier for the boats to come in.\n그래서?');
    expect(queryOf([message('assistant', 'Luna waits.')])).toBeNull();
  });
});

async function indexable(session: Session, count: number) {
  await answerable(session);
  const connection = session.store.list('connection')[0]!.id;
  await setDefaultModel(session.store, 'embed', { connection, model: 'm' });
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
  const records: MemoryRecord[] = Array.from({ length: count }, (_, i) => ({ id: `record-${i}`, at: i, sources: [], print: '', when: null, where: null, who: [], what: 'A record', lines: [], outcome: '', state: [], opens: [], closes: [], receipt: null }));
  const saved = await session.store.create('memory', { ...emptyMemory(), records }, { id: memoryId(chat), parent: chat });
  expect(saved.ok).toBe(true);
  return chat;
}

it('reports a failed final vector save separately from embedding failure', () => server.withSession(async (session) => {
  const chat = await indexable(session, 1);
  vi.spyOn(embeddingCalls, 'embedTexts').mockResolvedValue({ answer: { ok: true, model: 'm', vectors: [[1, 0]] }, receipt: null });
  const failure = { ok: false, error: 'storage-full' } as const;
  vi.spyOn(session.store, 'create').mockResolvedValue(failure);
  expect(await indexRecords(session, chat, new AbortController().signal, () => {})).toEqual({ ok: false, failure });
}));

it('stops indexing when its partial checkpoint cannot be saved', () => server.withSession(async (session) => {
  const chat = await indexable(session, embeddingCalls.EMBED_TEXTS + 1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
  const embed = vi.spyOn(embeddingCalls, 'embedTexts').mockImplementation(async (_deps, _route, texts) => {
    clock.mockReturnValue(60_000);
    return { answer: { ok: true, model: 'm', vectors: texts.map(() => [1, 0]) }, receipt: null };
  });
  const failure = { ok: false, error: 'conflict' } as const;
  const write = vi.spyOn(session.store, 'create').mockResolvedValue(failure);
  expect(await indexRecords(session, chat, new AbortController().signal, () => {})).toEqual({ ok: false, failure });
  expect(embed).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledOnce();
}));

it('reports a failed partial save when a later embedding batch fails', () => server.withSession(async (session) => {
  const chat = await indexable(session, embeddingCalls.EMBED_TEXTS + 1);
  vi.spyOn(Date, 'now').mockReturnValue(0);
  vi.spyOn(embeddingCalls, 'embedTexts')
    .mockResolvedValueOnce({ answer: { ok: true, model: 'm', vectors: Array.from({ length: embeddingCalls.EMBED_TEXTS }, () => [1, 0]) }, receipt: null })
    .mockResolvedValueOnce({ answer: { ok: false, reason: 'failed' }, receipt: null });
  const failure = { ok: false, error: 'storage-full' } as const;
  vi.spyOn(session.store, 'create').mockResolvedValue(failure);
  expect(await indexRecords(session, chat, new AbortController().signal, () => {})).toEqual({ ok: false, failure });
}));

it('keeps broken stored vectors verbatim, ignores them for retrieval, and uses them once repaired', () => server.withSession(async (session) => {
  const chat = await indexable(session, 1);
  const value = { model: 'm', items: { record: { at: 1, scale: 1, data: '%' } } };
  const id = vectorsId(chat);
  expect((await session.store.create('vectors', value, { id, parent: chat })).ok).toBe(true);
  const messages = [{ id: 'message', message: 'message', seed: 'message', role: 'user' as const, text: 'Find a record', time: null }];
  expect(retrievalOf(session.store, chat, messages)).toBeNull();
  expect(session.store.get('vectors', id)?.value).toEqual(value);
  expect((await session.store.update('vectors', id, () => ({ ...value, items: { record: { ...value.items.record, data: 'fwA=' } } }))).ok).toBe(true);
  expect(retrievalOf(session.store, chat, messages)?.items.record?.data).toBe('fwA=');
}));

it('overwrites broken stored vectors with a fresh index', () => server.withSession(async (session) => {
  const chat = await indexable(session, 1);
  const id = vectorsId(chat);
  expect((await session.store.create('vectors', { model: 'm', items: { 'record-0': { at: 0, scale: 1, data: '%' } } }, { id, parent: chat })).ok).toBe(true);
  vi.spyOn(embeddingCalls, 'embedTexts').mockResolvedValue({ answer: { ok: true, model: 'm', vectors: [[1, 0]] }, receipt: null });
  expect(await indexRecords(session, chat, new AbortController().signal, () => {})).toEqual({ ok: true });
  expect(chatVectors(session.store, chat)?.value.items['record-0']?.data).not.toBe('%');
}));
