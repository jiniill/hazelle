import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../engine/import/types';
import type { Chat } from '../model/chat';
import { foldTerm } from '../model/search';
import { ChatFinder, liveChats, results } from './chat-search';
import type { Write } from './object-writes';
import { ReadModels } from './read-model';
import type { ObjectStore } from './store';
import { testServer } from './testing';
import { MemoryCache } from './testing/cache';

const server = testServer();

const card = (name: string): Card => ({ name, nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '', creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false, bias: [], regex: [], triggers: [], loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null } });
const said = (chat: string, text: string): Write => ({ type: 'create', kind: 'entry', id: crypto.randomUUID(), parent: chat, value: { type: 'message', role: 'user', at: 0, text, receipt: null } });

// Each chat written on its own, so the later one is the newer.
async function chat(store: ObjectStore, value: Partial<Chat>, ...texts: string[]) {
  const id = crypto.randomUUID();
  const root: Write = { type: 'create', kind: 'chat', id, parent: null, value: { title: null, character: null, models: {}, ...value } };
  expect((await store.batch([root, ...texts.map((text) => said(id, text))], undefined, { unheld: true })).ok).toBe(true);
  return id;
}

async function finished(finder: ChatFinder) {
  await vi.waitFor(() => expect(finder.snapshot().running).toBe(false));
  return finder.snapshot();
}

describe('채팅 검색', () => {
  it('lists title hits first, then chats whose messages hold the term, each newest first, and no binned chat or binned character’s', async () => {
    const { store } = await server.account();
    const [luna, gone] = [crypto.randomUUID(), crypto.randomUUID()];
    expect((await store.create('character', { card: card('Luna'), folder: null, loreFolders: [] }, { id: luna })).ok).toBe(true);
    expect((await store.create('character', { card: card('Gone'), folder: null, loreFolders: [], deleted: Date.now() }, { id: gone })).ok).toBe(true);
    const named = await chat(store, { title: '용의 둥지', character: luna }, 'hello');
    const older = await chat(store, { character: luna }, 'first', '검은 <b>용</b>이 나타났다');
    const newer = await chat(store, {}, '용 하나', '아무것도', '용 둘');
    await chat(store, { character: gone }, '용');
    await chat(store, { deleted: Date.now() }, '용');
    await chat(store, {}, 'nothing here');
    const chats = liveChats(new ReadModels(store).library.snapshot());
    const finder = new ChatFinder(store);
    const term = foldTerm('용');
    finder.find(term, chats);
    const { found, read, unreadable } = results(chats, term, await finished(finder));
    expect(found.map(({ summary }) => summary.id)).toEqual([named, newer, older]);
    expect(found[0]!.title).toEqual({ text: '용의 둥지', from: 0, to: 1 });
    expect(found[0]!.hit).toBeNull();
    expect(found[1]!.hit).toMatchObject({ count: 2, lit: { text: '용 하나' } });
    expect(found[2]!.hit).toMatchObject({ count: 1, lit: { text: '검은 용이 나타났다', from: 3, to: 4 } });
    expect([read, unreadable]).toEqual([4, 0]);
  });

  it('goes on from what a stopped pass read for the same term, and starts over for another', async () => {
    const { store } = await server.account();
    for (const text of ['용', '용', '불']) await chat(store, {}, text);
    const chats = liveChats(new ReadModels(store).library.snapshot());
    const finder = new ChatFinder(store);
    const reads = vi.spyOn(store, 'chatEntries');
    finder.find('용', chats);
    finder.stop();
    expect(finder.snapshot().running).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(results(chats, '용', finder.snapshot()).read).toBe(0);
    finder.find('용', chats);
    expect(results(chats, '용', await finished(finder)).found).toHaveLength(2);
    expect(reads).toHaveBeenCalledTimes(3);
    finder.find('용', chats);
    expect(reads).toHaveBeenCalledTimes(3);
    finder.find('불', chats);
    expect(results(chats, '불', await finished(finder)).found).toHaveLength(1);
    expect(reads).toHaveBeenCalledTimes(6);
  });

  it('caches a chat it read as the chat’s whole scope, which a later pass and an opening read without the server', async () => {
    const { store, open } = await server.account();
    const id = await chat(store, {}, '용');
    expect((await store.create('textfile', { name: 'note', title: 'Note', text: 'kept' }, { parent: id })).ok).toBe(true);
    const device = await open(undefined, new MemoryCache());
    expect(await device.pull()).toBeNull();
    const first = await device.pinned((pin) => device.chatEntries(id, pin));
    expect(first.ok && first.data.map(({ value }) => value.type === 'message' && value.text)).toEqual(['용']);
    // With the account gone from the server, only the device answers.
    await server.wipe();
    const again = await device.pinned((pin) => device.chatEntries(id, pin));
    expect(again.ok && again.data).toHaveLength(1);
    const lease = device.retainChat(id, { summarize: false });
    expect(await lease.ready).toBeNull();
    expect(device.children('textfile', id).map(({ value }) => value.text)).toEqual(['kept']);
    lease.release();
  });

  it('asks the server again for a chat whose cached scope a pull left short', async () => {
    const { store, open } = await server.account();
    const id = await chat(store, {}, '용');
    const cache = new MemoryCache();
    const device = await open(undefined, cache);
    expect(await device.pull()).toBeNull();
    expect((await device.pinned((pin) => device.chatEntries(id, pin))).ok).toBe(true);
    cache.states.set(id, { ...cache.states.get(id)!, complete: false });
    await server.wipe();
    expect((await device.pinned((pin) => device.chatEntries(id, pin))).ok).toBe(false);
  });

  it('brings many chats down in one pass over the feed, each then read from the device whole', async () => {
    const { store, open } = await server.account();
    const ids: string[] = [];
    for (let at = 0; at < 70; at++) ids.push(await chat(store, {}, `용 ${at}`));
    expect((await store.create('textfile', { name: 'note', title: 'Note', text: 'kept' }, { parent: ids[0]! })).ok).toBe(true);
    const device = await open(undefined, new MemoryCache());
    expect(await device.pull()).toBeNull();
    const shares: number[] = [];
    expect(await device.pinned((pin) => device.fillChats(ids, pin, new AbortController().signal, (share) => shares.push(share)))).toEqual({ ok: true, data: null });
    expect(shares.at(-1)).toBe(1);
    await server.wipe();
    for (const id of ids) expect((await device.pinned((pin) => device.chatEntries(id, pin))).ok).toBe(true);
    const lease = device.retainChat(ids[0]!, { summarize: false });
    expect(await lease.ready).toBeNull();
    expect(device.children('textfile', ids[0]!).map(({ value }) => value.text)).toEqual(['kept']);
    lease.release();
  });
});
