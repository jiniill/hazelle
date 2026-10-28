import { describe, expect, it, vi } from 'vitest';
import { serverBackend } from './backend';
import { fold, shown } from '../model/chat';
import { TokenSnapshot } from './token-calibration';
import { fingerprint } from '../engine/memory';
import { memoryId, type Chapter, type MemorySettings } from '../model/memory';
import { appendUserMessage, editMessage, startChat } from './chat-log';
import { api } from './api';
import { setDefaultModel } from './assignment';
import * as retrieval from './retrieval';
import { chatMemory } from './memory-read';
import { editRecord, forgetRecord, removeFact, removeThread, setDefaultMemory, setFact, setThread } from './memory';
import { addPrompt, editPrompt } from './prompts';
import { ObjectStore } from './store';
import { openSession, type Session } from './session';
import { answerable, inTurn, saying, stubRelay, testServer } from './testing';
import { takeTurn } from './turn';
import { readTool } from '../engine/import/tool';
import { setModuleAlways } from './modules';
import { noOutcome } from './script-binding';
import { importTool } from './tools/store';

const server = testServer();

const summary = (what: string, line: string) =>
  JSON.stringify({ records: [{ to: 1, when: null, where: 'the pier', who: ['Luna', 'jin'], what, lines: [{ speaker: 'jin', text: line }], outcome: '', state: [{ about: 'Luna', field: 'place', value: 'the pier' }], opens: ['They meet again tomorrow.'], closes: [] }] });

describe('Rememberer', () => {
  it('summarizes the messages past the window once a reply is saved, and drops a result whose messages changed while it was written, then summarizes them as they are now', () =>
    server.withSession(async (session) => {
      await answerable(session);
      // A window of one token holds only the last message, and a batch of one token summarizes one message at a time.
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const said = crypto.randomUUID();
      await appendUserMessage(session.store, chat, { id: said, text: 'We meet at the pier.' });
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      const log = stubRelay(inTurn([saying('Luna waves.'), new Response(stream.readable, { headers: { 'x-relay': 'upstream' } }), saying(summary('jin and Luna meet at the pier at dawn.', 'We meet at the pier at dawn.'))]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(log).toHaveLength(2));
      expect(session.memory.snapshot().running.get(chat)).toMatchObject({ model: 'M' });

      const message = () => fold(session.store.children('entry', chat))[0]!;
      await editMessage(session.store, chat, message(), 'We meet at the pier at dawn.', null);
      const chunk = { choices: [{ delta: { content: summary('jin and Luna meet at the pier.', 'We meet at the pier.') }, finish_reason: 'stop' }] };
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`));
      await writer.close();

      await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(1));
      expect(log).toHaveLength(3);
      const memory = chatMemory(session.store, chat);
      expect(memory.records[0]).toMatchObject({ what: 'jin and Luna meet at the pier at dawn.', sources: [{ message: said, version: shown(message()).id }], receipt: { state: 'done', model: 'm' } });
      expect(memory.state).toEqual([{ about: 'Luna', field: 'place', value: 'the pier', record: memory.records[0]!.id }]);
      expect(memory.threads.map(({ text, opened }) => [text, opened])).toEqual([['They meet again tomorrow.', memory.records[0]!.id]]);
      await vi.waitFor(() => expect(session.memory.snapshot().running.size).toBe(0));
      await vi.waitFor(() => expect(session.store.list('stream')).toEqual([]));
      expect(session.store.get('memory', memoryId(chat))?.parent).toBe(chat);
    }));
  it('removes a fact that no longer holds and closes threads named by label and text or by text alone, as changes the new record keeps, never by a silent cut', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const said = crypto.randomUUID();
      const text = 'Luna waits at the pier.';
      await appendUserMessage(session.store, chat, { id: said, text });
      const earlier = { id: 'r0', sources: [{ message: said, version: said }], print: fingerprint([{ role: 'user', text }]), when: null, where: 'the pier', who: ['Luna'], what: 'Luna waits.', lines: [], outcome: '', state: [], opens: ['Luna waits for jin.'], closes: [], receipt: null, at: 0 };
      const thread = { id: crypto.randomUUID(), text: 'Luna waits for jin.', opened: 'r0' };
      const lamp = { id: crypto.randomUUID(), text: 'Luna wants a new lamp.', opened: 'r0' };
      await session.store.create(
        'memory',
        { records: [earlier], chapters: [], state: [{ about: 'Luna', field: 'place', value: 'the pier', record: 'r0' }, { about: 'Luna', field: 'mood', value: 'calm', record: 'r0' }], threads: [thread, lamp] },
        { id: memoryId(chat), parent: chat },
      );
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'jin arrives, and they leave the pier together.' });
      const answer = JSON.stringify({
        records: [{ to: 1, when: null, where: 'the pier', who: ['Luna', 'jin'], what: 'jin arrives and they leave together.', lines: [], outcome: '', state: [{ about: 'Luna', field: 'place', value: null }], opens: [], closes: [`T-${thread.id.slice(0, 8)}: Luna waits for jin.`, 'Luna wants a new lamp.'] }],
      });
      stubRelay(inTurn([saying('Luna smiles.'), saying(answer)]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(2));
      const memory = chatMemory(session.store, chat);
      expect(memory.state).toEqual([{ about: 'Luna', field: 'mood', value: 'calm', record: 'r0' }]);
      expect(memory.threads).toEqual([]);
      expect(memory.records[1]).toMatchObject({ state: [{ about: 'Luna', field: 'place', value: null }], closes: ['Luna waits for jin.', 'Luna wants a new lamp.'] });
    }));
  it("summarizes nothing while the chat's prompt holds no 장기 기억 slot, so no message leaves the request for a memory never sent", () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const made = await addPrompt(session.store, 'no memory', 'conversation');
      if (!made.ok) throw new Error('not saved');
      await editPrompt(session.store, made.data.id, { blocks: made.data.value.blocks.filter((block) => !(block.kind === 'slot' && block.slot === 'memory')) });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {}, prompt: made.data.id, sendsPrompt: true }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'We meet at the pier.' });
      const log = stubRelay(inTurn([saying('Luna waves.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      // A call the saved reply's check or this one planned would be in the log well within a second.
      session.memory.check(chat);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(log).toHaveLength(1);
      expect(chatMemory(session.store, chat).records).toEqual([]);
    }));
  it('summarizes nothing in a chat whose memory slot a tool holds', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const parsed = readTool(new TextEncoder().encode('//@api 1\n//@name keeper\n//@author jin\n//@uses memory'));
      if (!parsed.ok) throw new Error('fixture');
      const added = await importTool(session.store, session.files, parsed.tool);
      if (!added.ok) throw new Error(added.error);
      await setModuleAlways(session.store, added.data.id, true);
      await session.store.update('module', added.data.id, (current) => ({ ...current, takesMemory: true }));
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'We meet at the pier.' });
      const log = stubRelay(inTurn([saying('Luna waves.')]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      session.memory.check(chat);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(log).toHaveLength(1);
      expect(chatMemory(session.store, chat).records).toEqual([]);
    }, { run: async () => noOutcome(), close: () => {} }));

  it("leaves a stale record as it is while the chat's prompt holds no 장기 기억 slot, and still summarizes it again when the user asks", () =>
    server.withSession(async (session) => {
      await answerable(session);
      const made = await addPrompt(session.store, 'no memory', 'conversation');
      if (!made.ok) throw new Error('not saved');
      await editPrompt(session.store, made.data.id, { blocks: made.data.value.blocks.filter((block) => !(block.kind === 'slot' && block.slot === 'memory')) });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {}, prompt: made.data.id, sendsPrompt: true }, null);
      const said = crypto.randomUUID();
      await appendUserMessage(session.store, chat, { id: said, text: 'We meet at the pier.' });
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Luna waves.' });
      const stale = { id: 'r0', sources: [{ message: said, version: said }], print: 'another text', when: null, where: null, who: [], what: 'They meet.', lines: [], outcome: '', state: [], opens: [], closes: [], receipt: null, at: 0 };
      await session.store.create('memory', { records: [stale], chapters: [], state: [], threads: [] }, { id: memoryId(chat), parent: chat });
      const log = stubRelay(inTurn([saying(summary('jin and Luna meet at the pier.', 'We meet at the pier.'))]));
      session.memory.check(chat);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(log).toHaveLength(0);

      session.memory.rebuild(chat, 'r0');
      await vi.waitFor(() => expect(chatMemory(session.store, chat).records[0]).toMatchObject({ what: 'jin and Luna meet at the pier.' }));
      expect(log).toHaveLength(1);
    }));
  it('keeps a thread said again as the one thread already open', () =>
    server.withSession(async (session) => {
      await answerable(session);
      await setDefaultMemory(session.store, { window: 1, batch: 1 });
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
      const said = crypto.randomUUID();
      const text = 'Luna waits at the pier.';
      await appendUserMessage(session.store, chat, { id: said, text });
      const earlier = { id: 'r0', sources: [{ message: said, version: said }], print: fingerprint([{ role: 'user', text }]), when: null, where: null, who: ['Luna'], what: 'Luna waits.', lines: [], outcome: '', state: [], opens: ['Luna waits for jin.'], closes: [], receipt: null, at: 0 };
      await session.store.create('memory', { records: [earlier], chapters: [], state: [], threads: [{ id: crypto.randomUUID(), text: 'Luna waits for jin.', opened: 'r0' }] }, { id: memoryId(chat), parent: chat });
      await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'jin is late again.' });
      const answer = JSON.stringify({ records: [{ to: 1, when: null, where: null, who: ['jin'], what: 'jin is late.', lines: [], outcome: '', state: [], opens: ['Luna waits  for jin. '], closes: [] }] });
      stubRelay(inTurn([saying('Luna sighs.'), saying(answer)]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(2));
      expect(chatMemory(session.store, chat).threads.map(({ opened }) => opened)).toEqual(['r0']);
    }));
});

describe('a deletion from memory', () => {
  it('answers what it deleted when its first try landed unanswered, so 되돌리기 has it', async () => {
    const { accountId, vaultKey } = await server.account();
    let drop = false;
    const request = async <T,>(...args: Parameters<typeof api>) => {
      const result = await api<T>(...args);
      if (!drop || args[1] !== 'objects/batch') return result;
      drop = false;
      return { ok: false as const, error: 'offline' };
    };
    const store = await ObjectStore.open(accountId, vaultKey, serverBackend(request));
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: null, character: null, models: {} }, null);
    const record = { id: 'r0', sources: [], print: 'p', when: null, where: null, who: [], what: 'Luna waits.', lines: [], outcome: '', state: [], opens: [], closes: [], receipt: null, at: 0 };
    const fact = { about: 'Luna', field: 'place', value: 'the pier', record: 'r0' };
    await store.create('memory', { records: [record], chapters: [], state: [fact], threads: [] }, { id: memoryId(chat), parent: chat });

    const unanswered = async <T,>(write: () => Promise<T>) => {
      drop = true;
      const writing = write();
      await vi.waitFor(() => expect(store.waiting()).toBe(true));
      await vi.advanceTimersByTimeAsync(1000);
      return writing;
    };
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      expect(await unanswered(() => removeFact(store, chat, fact))).toEqual({ ok: true, data: fact });
      expect(await unanswered(() => forgetRecord(store, chat, 'r0'))).toEqual({ ok: true, data: record });
      expect(chatMemory(store, chat)).toEqual({ records: [{ ...record, forgotten: true }], chapters: [], state: [], threads: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('an edit of memory', () => {
  it('does not bring back a fact or a thread another device deleted meanwhile', async () => {
    const { store, open } = await server.account();
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: null, character: null, models: {} }, null);
    const fact = { about: 'Luna', field: 'place', value: 'the pier', record: null };
    const thread = { id: 't0', text: 'They meet again tomorrow.', opened: null };
    await store.create('memory', { records: [], chapters: [], state: [fact], threads: [thread] }, { id: memoryId(chat), parent: chat });
    const other = await open();
    await server.hold(other, chat);
    await removeFact(other, chat, fact);
    await removeThread(other, chat, thread.id);

    expect(await setFact(store, chat, { ...fact, value: 'the lighthouse' }, fact)).toEqual({ ok: false, error: 'gone' });
    expect(await setThread(store, chat, { ...thread, text: 'Tomorrow, at noon.' }, true)).toEqual({ ok: false, error: 'gone' });
    expect(chatMemory(store, chat)).toEqual({ records: [], chapters: [], state: [], threads: [] });
  });
});

describe('a summary picked up after a reload', () => {
  it('is dropped when its messages render differently than the call read them, though their versions are the same', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const { accountId, vaultKey } = await server.account();
    const open = async () => {
      const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal);
      if (!opened.ok) throw new Error(opened.error);
      opened.data.startBackground();
      return opened.data;
    };
    const first = await open();
    await answerable(first);
    await setDefaultMemory(first.store, { window: 1, batch: 1 });
    const chat = crypto.randomUUID();
    await server.hold(first.store, chat);
    await startChat(first.store, chat, { title: null, character: null, models: {}, variables: [['place', 'the pier']] }, null);
    await appendUserMessage(first.store, chat, { id: crypto.randomUUID(), text: 'We meet at {{getvar::place}}.' });
    const provider = new TransformStream<Uint8Array, Uint8Array>();
    const writer = provider.writable.getWriter();
    const log = stubRelay(inTurn([saying('Luna waves.'), new Response(provider.readable, { headers: { 'x-relay': 'upstream' } })]));
    expect(await takeTurn(first, chat, { kind: 'answer' })).toBeNull();
    await vi.waitFor(() => expect(first.store.list('stream').map(({ value, pending }) => [value.for.kind, pending])).toEqual([['memory', undefined]]));
    await vi.waitFor(() => expect(log).toHaveLength(2));
    first.close();

    const second = await open();
    try {
      await server.hold(second.store, chat);
      await vi.waitFor(() => expect(second.memory.snapshot().running.has(chat)).toBe(true));
      await second.store.update('chat', chat, (current) => ({ ...current, variables: [['place', 'the harbor']] }));
      // No key line, so nothing but the print tells the answer from one made of the text as it renders now.
      const answer = JSON.stringify({ records: [{ to: 1, when: null, where: 'the pier', who: ['jin'], what: 'They meet at the pier.', lines: [], outcome: '', state: [], opens: [], closes: [] }] });
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
      await writer.close();
      await vi.waitFor(() => expect(second.store.list('stream')).toEqual([]));
      expect(chatMemory(second.store, chat).records).toEqual([]);
    } finally {
      second.close();
    }
  });
});

describe('chapters', () => {
  const said = ['We meet at the pier.', 'Luna waves at jin.', 'jin promises to return.'];
  const chapterAnswer = JSON.stringify({ chapter: { when: null, where: 'the pier', who: ['Luna', 'jin'], what: 'They meet, and jin promises to return.', lines: [{ speaker: 'jin', text: 'jin promises to return.' }], outcome: '' } });
  const fact = { about: 'Luna', field: 'place', value: 'the pier', record: 'r0' };
  const thread = { id: crypto.randomUUID(), text: 'jin returns.', opened: 'r2' };

  // Three records, one message each, under a setting the state and threads fit in and the records only once consolidated.
  async function recorded(session: Session, settings: Partial<MemorySettings>, chapters: (ids: string[]) => Chapter[] = () => [], stale = false) {
    await answerable(session);
    await setDefaultMemory(session.store, { window: 1, batch: 1000, budget: 40, ...settings });
    const chat = crypto.randomUUID();
    await server.hold(session.store, chat);
    await startChat(session.store, chat, { title: null, character: null, models: {} }, null);
    const ids: string[] = [];
    for (const text of said) {
      const id = crypto.randomUUID();
      ids.push(id);
      await appendUserMessage(session.store, chat, { id, text });
    }
    const records = said.map((text, index) => ({ id: `r${index}`, sources: [{ message: ids[index]!, version: ids[index]! }], print: stale && index === 0 ? 'another text' : fingerprint([{ role: 'user', text }]), when: null, where: 'the pier', who: ['Luna'], what: `Event ${index}.`, lines: [], outcome: '', state: [], opens: [], closes: [], receipt: null, at: 0 }));
    await session.store.create('memory', { records, chapters: chapters(ids), state: [fact], threads: [thread] }, { id: memoryId(chat), parent: chat });
    await appendUserMessage(session.store, chat, { id: crypto.randomUUID(), text: 'Will you wait?' });
    return { chat, records };
  }

  it('summarizes the oldest records again into one chapter from their messages once memory passes its setting, leaving records, state and threads as they are', () =>
    server.withSession(async (session) => {
      const { chat, records } = await recorded(session, {});
      const log = stubRelay(inTurn([saying('Luna smiles.'), saying(chapterAnswer)]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(chatMemory(session.store, chat).chapters).toHaveLength(1));
      const memory = chatMemory(session.store, chat);
      expect(memory.chapters[0]).toMatchObject({ what: 'They meet, and jin promises to return.', records: [{ id: 'r0', at: 0 }, { id: 'r1', at: 0 }, { id: 'r2', at: 0 }], sources: records.flatMap(({ sources }) => sources) });
      expect([memory.records, memory.state, memory.threads]).toEqual([records, [fact], [thread]]);
      expect(log[1]!.sent.body).toContain('Write no state and no threads');
      await vi.waitFor(() => expect(session.store.list('stream')).toEqual([]));
      expect(log).toHaveLength(2);
    }));

  it('limits chapter source spans by the memory route calibrated allowance, not its native window', () =>
    server.withSession(async (session) => {
      const { chat } = await recorded(session, {});
      const snapshot = session.tokens.snapshot.bind(session.tokens);
      const decisions = vi.spyOn(session.tokens, 'snapshot').mockImplementation(async (...args) => {
        if (args[3] !== 'memory') return snapshot(...args);
        return { ok: true, data: new TokenSnapshot('memory-route', chat, { hard: 40, user: null, output: 0 }, [], { source: 'chat', evidence: 10, centre: 2, lower: 1.5, upper: 2, cold: false }) };
      });
      const log = stubRelay(inTurn([saying('Luna smiles.'), saying(chapterAnswer)]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(decisions.mock.calls.some((args) => args[3] === 'memory')).toBe(true));
      expect(chatMemory(session.store, chat).chapters).toEqual([]);
      expect(log).toHaveLength(1);
    }));

  it('holds a failed chapter apart and checks again when requested while the previous pass is finishing', () =>
    server.withSession(async (session) => {
      const { chat } = await recorded(session, {});
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let paused = false;
      const snapshot = session.tokens.snapshot.bind(session.tokens);
      vi.spyOn(session.tokens, 'snapshot').mockImplementation(async (...args) => {
        const result = await snapshot(...args);
        // This plan already read the old batch size; it will find no work after the failed chapter.
        if (args[3] === 'memory' && session.memory.snapshot().chapterFailed.has(chat)) {
          paused = true;
          await held;
        }
        return result;
      });
      try {
        stubRelay(inTurn([saying('Luna smiles.'), saying('No chapter today.')]));
        expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
        await vi.waitFor(() => expect(paused).toBe(true));
        expect(session.memory.snapshot().chapterFailed.get(chat)).toMatchObject({ kind: 'invalid', reason: 'unreadable' });
        expect(session.memory.snapshot().failed.has(chat)).toBe(false);

        await setDefaultMemory(session.store, { batch: 1, budget: 1_000_000 });
        const log = stubRelay(inTurn([saying(summary('jin asks Luna to wait.', 'Will you wait?'))]));
        session.memory.check(chat);
        session.memory.check(chat);
        release();
        await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(4));
        await vi.waitFor(() => expect(session.memory.snapshot().running.has(chat)).toBe(false));
        expect(chatMemory(session.store, chat).chapters).toEqual([]);
        expect(log).toHaveLength(1);
      } finally { release(); }
    }));

  it('coalesces checks during indexing into another pass without starting a concurrent summary', () =>
    server.withSession(async (session) => {
      const { chat } = await recorded(session, { budget: 1_000_000 });
      const connection = session.store.list('connection')[0]!.id;
      await setDefaultModel(session.store, 'embed', { connection, model: 'm' });
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const indexing = vi.spyOn(retrieval, 'indexRecords').mockImplementation(async () => {
        await held;
        return { ok: true };
      });
      try {
        const log = stubRelay(inTurn([saying('Luna smiles.'), saying(summary('jin asks Luna to wait.', 'Will you wait?'))]));
        expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
        await vi.waitFor(() => expect(indexing).toHaveBeenCalledTimes(1));
        await setDefaultMemory(session.store, { batch: 1 });
        session.memory.check(chat);
        session.memory.check(chat);
        expect(log).toHaveLength(1);
        release();
        await vi.waitFor(() => expect(chatMemory(session.store, chat).records).toHaveLength(4));
        await vi.waitFor(() => expect(indexing).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(session.memory.snapshot().indexing.size).toBe(0));
        await vi.waitFor(() => expect(session.memory.snapshot().running.size).toBe(0));
        expect(log).toHaveLength(2);
      } finally {
        release();
        indexing.mockRestore();
      }
    }));

  it('drops a chapter whose record the user edited while it was written', () =>
    server.withSession(async (session) => {
      const { chat } = await recorded(session, {});
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      const log = stubRelay(inTurn([saying('Luna smiles.'), new Response(stream.readable, { headers: { 'x-relay': 'upstream' } })]));
      expect(await takeTurn(session, chat, { kind: 'answer' })).toBeNull();
      await vi.waitFor(() => expect(log).toHaveLength(2));
      await editRecord(session.store, chat, 'r1', { what: 'jin waves back.' });
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chapterAnswer }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
      await writer.close();
      await vi.waitFor(() => expect(session.store.list('stream')).toEqual([]));
      await vi.waitFor(() => expect(session.memory.snapshot().running.size).toBe(0));
      expect([chatMemory(session.store, chat).chapters, session.memory.snapshot().chapterFailed.size, log.length]).toEqual([[], 0, 2]);
    }));

  const meeting = (ids: string[]): Chapter[] => [
    { id: 'c0', sources: ids.slice(0, 2).map((id) => ({ message: id, version: id })), print: fingerprint(said.slice(0, 2).map((text) => ({ role: 'user', text }))), when: null, where: null, who: [], what: 'They meet.', lines: [], outcome: '', receipt: null, at: 0, records: [{ id: 'r0', at: 0 }, { id: 'r1', at: 0 }] },
  ];

  it('names the records a record inside a chapter is summarized again into, and leaves the chapter for the user to make again', () =>
    server.withSession(async (session) => {
      const chapter = meeting;
      const { chat } = await recorded(session, { budget: 1_000_000 }, chapter, true);
      const log = stubRelay(inTurn([saying(summary('jin and Luna meet.', 'We meet at the pier.'))]));
      session.memory.check(chat);
      await vi.waitFor(() => expect(chatMemory(session.store, chat).records[0]).toMatchObject({ what: 'jin and Luna meet.' }));
      const memory = chatMemory(session.store, chat);
      expect(memory.chapters[0]!.records).toEqual([{ id: memory.records[0]!.id, at: 0 }, { id: 'r1', at: 0 }]);
      await vi.waitFor(() => expect(session.memory.snapshot().running.size).toBe(0));
      expect(log).toHaveLength(1);
    }));

  it('makes a chapter the user asks for again after its stale records, so their new summaries do not outdate it', () =>
    server.withSession(async (session) => {
      const { chat } = await recorded(session, { budget: 1_000_000 }, meeting, true);
      const again = JSON.stringify({ chapter: { when: null, where: 'the pier', who: ['Luna', 'jin'], what: 'They meet again.', lines: [{ speaker: 'jin', text: 'We meet at the pier.' }], outcome: '' } });
      const log = stubRelay(inTurn([saying(summary('jin and Luna meet.', 'We meet at the pier.')), saying(again)]));
      session.memory.rebuild(chat, 'c0');
      await vi.waitFor(() => expect(chatMemory(session.store, chat).chapters[0]).toMatchObject({ what: 'They meet again.' }));
      const memory = chatMemory(session.store, chat);
      expect(memory.chapters[0]!.records).toEqual([memory.records[0]!, memory.records[1]!].map(({ id, at }) => ({ id, at })));
      expect([memory.records[0]!.what, log.length]).toEqual(['jin and Luna meet.', 2]);
    }));

  it('commits a chapter call picked up after a reload as a chapter', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const { accountId, vaultKey } = await server.account();
    const open = async () => {
      const opened = await openSession(accountId, vaultKey, 'jin', new AbortController().signal);
      if (!opened.ok) throw new Error(opened.error);
      opened.data.startBackground();
      return opened.data;
    };
    const first = await open();
    const { chat } = await recorded(first, {});
    const provider = new TransformStream<Uint8Array, Uint8Array>();
    const writer = provider.writable.getWriter();
    const log = stubRelay(inTurn([saying('Luna smiles.'), new Response(provider.readable, { headers: { 'x-relay': 'upstream' } })]));
    expect(await takeTurn(first, chat, { kind: 'answer' })).toBeNull();
    await vi.waitFor(() => expect(first.store.list('stream').map(({ value, pending }) => [value.for, pending])).toEqual([[expect.objectContaining({ kind: 'memory', chapter: ['r0', 'r1', 'r2'] }), undefined]]));
    await vi.waitFor(() => expect(log).toHaveLength(2));
    const result = first.store.list('stream')[0]!.value.result;
    first.close();

    const second = await open();
    try {
      await server.hold(second.store, chat);
      await vi.waitFor(() => expect(second.memory.snapshot().running.has(chat)).toBe(true));
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chapterAnswer }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`));
      await writer.close();
      await vi.waitFor(() => expect(second.store.list('stream')).toEqual([]));
      expect(chatMemory(second.store, chat).chapters.map(({ id, records }) => [id, records.map(({ id }) => id)])).toEqual([[result, ['r0', 'r1', 'r2']]]);
    } finally {
      second.close();
    }
  });

  it('shows vector storage failures through the existing unsaved indexing failure path', () => server.withSession(async (session) => {
    const { chat } = await recorded(session, { budget: 1_000_000 });
    const connection = session.store.list('connection')[0]!.id;
    const failure = { ok: false, error: 'storage-full' } as const;
    const indexing = vi.spyOn(retrieval, 'indexRecords').mockResolvedValue({ ok: false, failure });
    try {
      await setDefaultModel(session.store, 'embed', { connection, model: 'm' });
      session.memory.check(chat);
      await vi.waitFor(() => expect(session.memory.snapshot().indexFailed.get(chat)).toEqual({ kind: 'unsaved', failure }));
    } finally { indexing.mockRestore(); }
  }));
});
