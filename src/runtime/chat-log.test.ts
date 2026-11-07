import { describe, expect, it, vi } from 'vitest';
import { calls, fold, foldTree, shown, translationOutdated, type Chat, type Message, type Receipt, type Version } from '../model/chat';
import { cachePrintId } from '../model/cache';
import { memoryId, type MemoryRecord } from '../model/memory';
import { chatPrint } from './cache';
import { chatFile, readChatFile } from './chat-file';
import { appendCost, appendReply, appendScripted, appendTranslation, appendUserMessage, copyChat, copyShown, editMessage, forgetOrigin, importChat, nameBookmark, removeMessage, removeMessages, restoreMessages, selectVersion, setBookmark, setCast, setChatOwn, setVariableByHand, startChat, withOwn } from './chat-log';
import { setChatModel, withMainModel } from './assignment';
import type { Files } from './files';
import { summaryId } from './summary';
import { greetingPreview, projectGreetings } from './greetings';
import { BATCH_LIMITS } from '../contracts/objects';
import { testServer } from './testing';
import { evaluateChat } from './chat-context';
import { saveToolChat, toolBadges, toolChatData } from './tools/store';
import { addLore, addLoreFolder } from './lore';
import { createFolder, moveInto } from './folders';
import { createCharacter } from './characters';

const server = testServer();

describe('startChat', () => {
  it('opens the chat on the greeting that was shown, first and last included, under the ids it was shown with, so its tags roll the same, and never holds the chat without it', async () => {
    const { store } = await server.account();
    const reader = { store, username: 'jin' };
    const texts = ['하나 {{pick}} {{random}}', '둘', '셋'];
    const opened = async (selected: number) => {
      const id = crypto.randomUUID();
      await server.hold(store, id);
      const chat: Chat = { title: null, character: null, models: {} };
      const greetings = projectGreetings(texts, texts.map(() => crypto.randomUUID()), selected)!;
      const preview = greetingPreview(greetings, 0)!;
      const before = await evaluateChat(reader, id, chat, [preview]);
      let bare = false;
      const leave = store.subscribe(() => {
        bare ||= store.get('chat', id) !== null && store.children('entry', id).length === 0;
      });
      expect(await startChat(store, id, chat, greetings)).toBeNull();
      leave();
      expect(bare).toBe(false);
      const messages = fold(store.children('entry', id));
      expect(messages[0]!.versions.map((version) => version.id)).toEqual(preview.versions.map((version) => version.id));
      expect(await evaluateChat(reader, id, chat, messages)).toEqual(before);
      return [shown(messages[0]!).text, messages[0]!.versions.length];
    };
    expect(await opened(0)).toEqual(['하나 {{pick}} {{random}}', 3]);
    expect(await opened(2)).toEqual(['셋', 3]);
  });
});

describe('setCast', () => {
  it("keeps each character once, never the chat's own, at most five, and none as no list", async () => {
    const { store } = await server.account();
    const id = crypto.randomUUID();
    expect(await startChat(store, id, { title: null, character: 'own', models: {} }, null)).toBeNull();
    await setCast(store, id, ['a', 'own', 'b', 'a', 'c', 'd', 'e', 'f']);
    expect(store.get('chat', id)!.value.cast).toEqual(['a', 'b', 'c', 'd', 'e']);
    await setCast(store, id, []);
    expect('cast' in store.get('chat', id)!.value).toBe(false);
  });
});

describe('removeMessages', () => {
  it('deletes a message and every one after it together, and restores them together', async () => {
    const { store } = await server.account();
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: null, character: null, models: {} }, null);
    const said = Array.from({ length: 5 }, () => crypto.randomUUID());
    for (const [index, message] of said.entries()) await appendUserMessage(store, chat, { id: message, text: `말 ${index}`, follows: said[index - 1] ?? null });
    const texts = () => fold(store.children('entry', chat)).map((message) => shown(message).text);
    expect(await removeMessages(store, chat, said.slice(2))).toEqual({ ok: true, data: null });
    expect(texts()).toEqual(['말 0', '말 1']);
    await restoreMessages(store, chat, said.slice(2));
    expect(texts()).toEqual(['말 0', '말 1', '말 2', '말 3', '말 4']);
  });
});

describe('copyShown', () => {
  it("shows a copy of the version shown, with what the bot's Lua wrote around it, and leaves what followed on the version it copied", async () => {
    const { store } = await server.account();
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: null, character: null, models: {} }, null);
    const said = crypto.randomUUID();
    await appendUserMessage(store, chat, { id: said, text: '안녕', follows: null, before: [['order', 'input']] });
    await appendScripted(store, chat, { edits: [], removed: [], added: [], vars: { version: said, set: [['hp', '9']] } });
    await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: '다음', follows: said });
    const folded = () => fold(store.children('entry', chat));
    expect(await copyShown(store, chat, folded()[0]!)).toMatchObject({ ok: true });
    const [copy, ...rest] = folded();
    expect(rest).toEqual([]);
    const held = ({ text, seed, before, after }: Version) => ({ text, seed, before, after });
    expect(copy!.selected).toBe(1);
    expect(held(shown(copy!))).toEqual(held(copy!.versions[0]!));
    await selectVersion(store, chat, copy!.id, said);
    expect(folded().map((message) => shown(message).text)).toEqual(['안녕', '다음']);
  });

  it('gives the copy the pictures and remarks of the version it copied, and not those of its other versions', async () => {
    const { store, files } = await server.account();
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: null, character: null, models: {} }, null);
    const receipt: Receipt = { id: crypto.randomUUID(), connection: 'c', source: 'S', model: 'm', modelName: 'M', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: null, totalMs: 1, cache: null };
    const [first, swipe] = [crypto.randomUUID(), crypto.randomUUID()];
    await appendReply(store, chat, { id: first, message: null, replaces: null, at: 1, text: '첫 답', receipt });
    await appendReply(store, chat, { id: swipe, message: first, replaces: null, at: 2, text: '둘째 답', receipt });
    const stored = await files.save([new Uint8Array([1, 2, 3])]);
    const scene = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };
    const sent = { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 };
    await store.create('illustration', { message: first, version: swipe, scene, receipt: null, model: { connection: 'c', model: 'm' }, sent, file: stored.ok ? stored.data[0]! : { id: '', key: '' }, type: 'image/png', size: 3, at: 4 }, { parent: chat });
    const remark = (version: string, line: string) => store.create('remark', { message: first, version, mascot: 'yeongae', expression: 'calm', line, receipt, model: { connection: 'c', model: 'm' }, at: 3 }, { parent: chat });
    await remark(first, '첫 줄');
    await remark(swipe, '둘째 줄');
    const [message] = fold(store.children('entry', chat));
    expect(await copyShown(store, chat, message!)).toMatchObject({ ok: true });
    const copy = shown(fold(store.children('entry', chat))[0]!);
    expect(copy.text).toBe('둘째 답');
    expect(store.children('illustration', chat).filter(({ value }) => value.version === copy.id)).toHaveLength(1);
    expect(store.children('remark', chat).filter(({ value }) => value.version === copy.id).map(({ value }) => value.line)).toEqual(['둘째 줄']);
  });
});

describe('bookmarks', () => {
  const said = async () => {
    const { store, files } = await server.account();
    const id = crypto.randomUUID();
    await server.hold(store, id);
    await startChat(store, id, { title: '등대', character: null, models: {} }, null);
    const messages = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, message] of messages.entries()) await appendUserMessage(store, id, { id: message, text: `말 ${index}`, follows: messages[index - 1] ?? null });
    return { store, files, id, messages };
  };

  it('marks a message once, keeps its name when marked again, and leaves no list once the last is unmarked', async () => {
    const { store, id, messages: [first, second] } = await said();
    const marks = () => store.get('chat', id)!.value.bookmarks;
    await setBookmark(store, id, first!, true);
    await setBookmark(store, id, second!, true);
    await nameBookmark(store, id, first!, ' 시작 ');
    await setBookmark(store, id, first!, true);
    expect(marks()).toEqual([{ message: first, name: '시작' }, { message: second }]);
    await nameBookmark(store, id, first!, ' ');
    expect(marks()).toEqual([{ message: first }, { message: second }]);
    await setBookmark(store, id, second!, false);
    await setBookmark(store, id, second!, true, '고백');
    expect(marks()).toEqual([{ message: first }, { message: second, name: '고백' }]);
    await setBookmark(store, id, first!, false);
    await setBookmark(store, id, second!, false);
    expect('bookmarks' in store.get('chat', id)!.value).toBe(false);
    expect(await nameBookmark(store, id, first!, '없음')).toMatchObject({ ok: false, error: 'gone' });
  });

  it("goes with a chat file and a branch under the copies' ids, only for the messages they copy", async () => {
    const { store, files, id, messages: [first, second, third] } = await said();
    await setBookmark(store, id, first!, true);
    await nameBookmark(store, id, first!, '시작');
    await setBookmark(store, id, second!, true);
    await setBookmark(store, id, third!, true);
    await removeMessage(store, id, second!);
    const shownTexts = (chat: string) => {
      const bookmarks = store.get('chat', chat)!.value.bookmarks!;
      const messages = fold(store.children('entry', chat));
      return bookmarks.map(({ message, name }) => [shown(messages.find((each) => each.id === message)!).text, name]);
    };

    const written = await chatFile({ store, files }, id);
    if (!written.ok) throw new Error(written.error);
    const read = readChatFile(JSON.parse(written.data));
    if (!read.ok) throw new Error(read.error);
    const imported = await importChat({ store, files }, read.file, null);
    if (!imported.ok) throw new Error(imported.error);
    await server.hold(store, imported.data.id);
    expect(shownTexts(imported.data.id)).toEqual([['말 0', '시작'], ['말 2', undefined]]);

    const branched = await copyChat(store, id, { kind: 'branch', at: first! });
    if (!branched.ok) throw new Error(branched.error);
    await server.hold(store, branched.data.id);
    expect(shownTexts(branched.data.id)).toEqual([['말 0', '시작']]);
  });
});

describe('a chat folder', () => {
  it("stays with a branch, and with a chat file only when it comes back into the folder's character", async () => {
    const { store, files } = await server.account();
    const id = crypto.randomUUID();
    await server.hold(store, id);
    await startChat(store, id, { title: '등대', character: null, models: {} }, null);
    const first = crypto.randomUUID();
    await appendUserMessage(store, id, { id: first, text: '안녕', follows: null });
    const made = await createFolder(store, { chats: null }, '모험', null);
    const folder = made.ok ? made.data.id : '';
    await moveInto(store, 'chat', [id], folder);

    const branched = await copyChat(store, id, { kind: 'branch', at: first });
    if (!branched.ok) throw new Error(branched.error);
    expect(store.get('chat', branched.data.id)!.value.folder).toBe(folder);

    const written = await chatFile({ store, files }, id);
    if (!written.ok) throw new Error(written.error);
    const read = readChatFile(JSON.parse(written.data));
    if (!read.ok) throw new Error(read.error);
    const character = crypto.randomUUID();
    await createCharacter(store, '루나', character);
    const imported = await Promise.all([importChat({ store, files }, read.file, null), importChat({ store, files }, read.file, character)]);
    expect(imported.map((each) => each.ok && store.get('chat', each.data.id)!.value.folder)).toEqual([folder, undefined]);
  });
});

describe('a chat not saved yet', () => {
  it('takes its picks through the same transforms the saved chat is written with', async () => {
    const { store } = await server.account();
    const id = crypto.randomUUID();
    const unsaved: Chat = { title: null, character: null, models: {}, note: 'old' };
    expect(await startChat(store, id, unsaved, null)).toBeNull();
    const ref = { connection: 'c', model: 'm' };
    await setChatModel(store, id, ref);
    await setChatOwn(store, id, 'prompt', 'p');
    await setChatOwn(store, id, 'note', null);
    expect(store.get('chat', id)!.value).toEqual(withOwn(withOwn(withMainModel(unsaved, ref), 'prompt', 'p'), 'note', null));
  });
});

describe('copyChat', () => {
  it('names a branch of an untitled branch after the root, and forgetOrigin drops the origin', async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: '기숙사의 밤', character: null, models: {} };
    await startChat(store, source, chat, null);
    const said = crypto.randomUUID();
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    const first = await copyChat(store, source, { kind: 'branch', at: said });
    if (!first.ok) throw new Error(first.error);
    await server.hold(store, first.data.id);
    const again = await copyChat(store, first.data.id, { kind: 'branch', at: first.data.messages[said]! });
    if (!again.ok) throw new Error(again.error);
    await server.hold(store, again.data.id);
    expect(store.get('chat', again.data.id)!.value.origin).toMatchObject({ id: first.data.id, name: '기숙사의 밤' });
    expect(await forgetOrigin(store, again.data.id)).toMatchObject({ ok: true });
    expect(store.get('chat', again.data.id)!.value.origin).toBeUndefined();
  });

  it("duplicates a chat whole under the name given, as no one's branch, keeping the seed", async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: '기숙사의 밤', character: null, models: {} };
    await startChat(store, source, chat, null);
    const last = crypto.randomUUID();
    await appendUserMessage(store, source, { id: crypto.randomUUID(), text: '안녕' });
    await appendUserMessage(store, source, { id: last, text: '잘 자' });
    const branched = await copyChat(store, source, { kind: 'branch', at: last });
    if (!branched.ok) throw new Error(branched.error);
    await server.hold(store, branched.data.id);
    const copied = await copyChat(store, branched.data.id, { kind: 'duplicate', title: '기숙사의 밤 · 분기 (사본)' });
    if (!copied.ok) throw new Error(copied.error);
    await server.hold(store, copied.data.id);
    const texts = (id: string) => fold(store.children('entry', id)).map((message) => shown(message).text);
    expect(texts(copied.data.id)).toEqual(['안녕', '잘 자']);
    expect(store.get('chat', copied.data.id)!.value).toEqual({ ...chat, title: '기숙사의 밤 · 분기 (사본)', seed: source });
    expect(copied.data.from).toBe(branched.data.id);
  });

  it("carries what the bot's Lua wrote, the texts it staged, the tools' data, badges on the branch's messages, the chat's inlays and its cache print", async () => {
    const { store, files } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: null, character: null, models: {} };
    await startChat(store, source, chat, null);
    const said = crypto.randomUUID();
    await appendUserMessage(store, source, { id: said, text: '안녕', before: [['order', 'input']] });
    const folded = () => fold(store.children('entry', source));
    await appendScripted(store, source, { edits: [{ message: folded()[0]!, text: '안녕!', wrote: [['typed', '1']] }], removed: [], added: [{ follows: said, ahead: null, messages: [{ role: 'assistant', text: 'narration' }] }], vars: { version: said, set: [['hp', '9']] } });
    await appendScripted(store, source, { edits: [], removed: [], added: [], vars: { version: said, set: [['door', 'open']], stays: true } });
    await setVariableByHand(store, source, said, 'hp', '5');
    const held = (messages: Message[]) => messages.map((message) => [shown(message).text, shown(message).staged, shown(message).before, shown(message).after, message.after, shown(message).byHand]);
    expect(held(folded())).toEqual([['안녕!', true, [['order', 'input'], ['typed', '1']], [['hp', '9']], [['door', 'open']], [['hp', '5']]], ['narration', true, undefined, undefined, undefined, undefined]]);

    const module = crypto.randomUUID();
    await store.create('module', { name: '기억', description: '', namespace: null, loreFolders: [], regex: [], triggers: [], toggles: [] }, { id: module });
    const narration = folded()[1]!;
    await saveToolChat(store, module, source, [['index', { node: said }]], [{ message: said, version: shown(folded()[0]!).id, text: '요약됨' }, { message: narration.id, version: shown(narration).id, text: '마지막' }]);

    const saved = await files.save([new Uint8Array(2)]);
    if (!saved.ok) throw new Error(saved.error);
    const inlay = { name: 'risu-id', type: 'image/png', size: 2, file: saved.data[0]! };
    await store.create('inlay', inlay, { parent: source });
    const print = { call: 'r', connection: 'c', account: 'a', model: 'm', messages: [{ role: 'user' as const, hash: 'h', tokens: 1, from: { kind: 'block' as const, name: null, slot: null } }] };
    await store.create('cacheprint', print, { id: cachePrintId(source), parent: source });

    const branched = await copyChat(store, source, { kind: 'branch', at: folded()[1]!.id });
    if (!branched.ok) throw new Error(branched.error);
    await server.hold(store, branched.data.id);
    const copy = fold(store.children('entry', branched.data.id));
    expect(held(copy)).toEqual(held(folded()));
    expect(toolChatData(store, module, branched.data.id, 'index')).toEqual({ node: said });
    expect(toolBadges(store, module, branched.data.id)).toEqual(Object.fromEntries(copy.map((message, index) => [message.id, { version: shown(message).id, text: ['요약됨', '마지막'][index]! }])));
    expect(store.children('inlay', branched.data.id).map(({ value }) => value)).toEqual([inlay]);
    expect(chatPrint(store, branched.data.id)?.value).toEqual(print);

    await appendScripted(store, source, { edits: [], removed: [], added: [{ follows: said, ahead: folded()[1]!, messages: [{ role: 'user', text: 'between' }] }], vars: null });
    const texts = (messages: Message[]) => messages.map((message) => shown(message).text);
    expect(texts(folded())).toEqual(['안녕!', 'between', 'narration']);
    const inserted = await copyChat(store, source, { kind: 'branch', at: folded()[2]!.id });
    if (!inserted.ok) throw new Error(inserted.error);
    await server.hold(store, inserted.data.id);
    expect(texts(fold(store.children('entry', inserted.data.id)))).toEqual(['안녕!', 'between', 'narration']);
  });

  it('copies the messages up to the split as they fold, rolling the same, without the deleted one, and saves the chat after them', async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: '기숙사의 밤', character: null, models: {}, note: '노트' };
    const pending: Receipt = { id: crypto.randomUUID(), connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: 'pending', replyId: 'r1', firstTextMs: 100, totalMs: 900, cache: null };
    const said = crypto.randomUUID();
    const deleted = crypto.randomUUID();
    const split = crypto.randomUUID();
    const folded = () => fold(store.children('entry', source));

    await startChat(store, source, chat, projectGreetings(['하나', '둘 {{random::빨강::파랑::노랑::초록}} {{pick::봄::여름::가을::겨울}}', '셋'], [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], 1));
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    await editMessage(store, source, folded().find((message) => message.id === said)!, '안녕하세요', null);
    const reply = crypto.randomUUID();
    const cut: Receipt = { ...pending, state: 'cut', cut: 'length' };
    await appendReply(store, source, { id: reply, message: null, replaces: null, at: 1, text: '답', receipt: cut });
    const continued = crypto.randomUUID();
    await appendReply(store, source, { id: continued, message: reply, replaces: reply, at: 2, text: '답장', receipt: { ...pending, cost: null, replyId: null, continues: cut } });
    await appendCost(store, source, pending, { unit: 'usd', amount: 0.01, source: 'reported' });
    await appendTranslation(store, source, continued, { text: 'A reply', receipt: pending, at: 3 }, crypto.randomUUID());
    await appendUserMessage(store, source, { id: deleted, text: '지울 말' });
    await removeMessage(store, source, deleted);
    await store.batch(
      Array.from({ length: BATCH_LIMITS.items + 1 }, (_, index) => ({
        type: 'create' as const,
        kind: 'entry' as const,
        id: crypto.randomUUID(),
        parent: source,
        value: { type: 'message' as const, role: 'user' as const, at: index, text: `말 ${index} {{random}}`, receipt: null },
      })),
    );
    await appendUserMessage(store, source, { id: split, text: '여기서' });
    await appendUserMessage(store, source, { id: crypto.randomUUID(), text: '갈래에 없는 말' });
    const story = folded();
    expect(shown(story[1]!).seed).toBe(said);

    const requests = vi.spyOn(globalThis, 'fetch');
    const branched = await copyChat(store, source, { kind: 'branch', at: split });
    if (!branched.ok) throw new Error(branched.error);
    await server.hold(store, branched.data.id);
    const entries = store.children('entry', branched.data.id);
    expect(entries.length).toBeGreaterThan(BATCH_LIMITS.items);
    const batches = requests.mock.calls.filter(([url]) => url === '/api/objects/batch').map(([, init]) => (JSON.parse(init!.body as string) as { writes: { id: string; kind: string }[] }).writes.filter(({ kind }) => kind !== 'summary')).filter((writes) => writes.length);
    expect(batches.flat()).toHaveLength(entries.length + 1);
    expect(batches.every((batch) => batch.length <= BATCH_LIMITS.items)).toBe(true);
    expect(batches.at(-1)!.at(-1)!.id).toBe(branched.data.id);
    const copy = fold(entries);
    const withoutIds = (messages: Message[]) =>
      messages.map(({ role, at, selected, versions }) => ({ role, at, selected, versions: versions.map(({ seed, text, receipt, edited, at: written, translation, greeting }) => ({ seed, text, receipt, edited, written, translation, greeting })) }));
    expect(withoutIds(copy)).toEqual(withoutIds(story.slice(0, -1)));
    expect([copy[0]!.versions.length, shown(copy[1]!).text, shown(copy[1]!).edited]).toEqual([3, '안녕하세요', true]);
    expect([shown(copy[2]!).text, copy[2]!.versions.length, calls(shown(copy[2]!).receipt!).map((call) => call.cost)]).toEqual(['답장', 1, [{ unit: 'usd', amount: 0.01, source: 'reported' }, null]]);
    const stored = store.get('chat', branched.data.id)!;
    expect(stored.value).toEqual({ ...chat, title: null, origin: { id: source, name: '기숙사의 밤', after: copy.at(-1)!.id }, seed: source });
    const reader = { store, username: 'jin' };
    expect(await evaluateChat(reader, branched.data.id, stored.value, copy)).toEqual(await evaluateChat(reader, source, chat, story.slice(0, -1)));
    expect(stored.rev).toBeGreaterThan(Math.max(...entries.map((entry) => entry.rev)));
  }, 15_000);
  it('carries the memory records whose every message lies before the split, their sources remapped, with the facts and threads as they stood before a later record changed them, and a chapter only with all its records and messages', async () => {
    const { store } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: null, character: null, models: {} };
    await startChat(store, source, chat, null);
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const [index, id] of ids.entries()) await appendUserMessage(store, source, { id, text: `말 ${index}` });
    await editMessage(store, source, fold(store.children('entry', source))[1]!, '고친 말', null);
    const messages = fold(store.children('entry', source));
    const sourcesOf = (from: number, to: number) => messages.slice(from, to).map((message) => ({ message: message.id, version: shown(message).id }));
    const record = (id: string, sources: MemoryRecord['sources'], changes: Pick<MemoryRecord, 'state' | 'opens' | 'closes'>): MemoryRecord => ({ id, sources, print: 'p', when: null, where: null, who: [], what: id, lines: [], outcome: '', receipt: null, at: 0, ...changes });
    const chapter = (id: string, records: string[]) => ({ id, sources: sourcesOf(0, 2 * records.length), print: 'p', when: null, where: null, who: [], what: id, lines: [], outcome: '', receipt: null, at: 0, records: records.map((each) => ({ id: each, at: 0 })) });
    await store.create(
      'memory',
      {
        records: [
          record('before', sourcesOf(0, 2), { state: [{ about: 'Luna', field: 'mood', value: 'calm' }, { about: 'Luna', field: 'place', value: 'home' }, { about: 'jin', field: 'coat', value: 'red' }], opens: ['A vow'], closes: [] }),
          record('across', sourcesOf(2, 4), { state: [{ about: 'Luna', field: 'place', value: 'pier' }], opens: ['A promise'], closes: ['A vow'] }),
        ],
        chapters: [chapter('kept', ['before']), chapter('split', ['before', 'across']), { ...chapter('read past', ['before']), sources: sourcesOf(0, 4) }],
        state: [
          { about: 'Luna', field: 'mood', value: 'calm', record: 'before' },
          { about: 'Luna', field: 'place', value: 'pier', record: 'across' },
          { about: 'jin', field: 'name', value: 'Jin', record: null },
        ],
        threads: [
          { id: 't1', text: 'A promise', opened: 'across' },
          { id: 't2', text: 'The user’s own', opened: null },
        ],
      },
      { id: memoryId(source), parent: source },
    );
    const branched = await copyChat(store, source, { kind: 'branch', at: ids[2]! });
    if (!branched.ok) throw new Error(branched.error);
    await server.hold(store, branched.data.id);
    const copy = fold(store.children('entry', branched.data.id));
    const memory = store.get('memory', memoryId(branched.data.id))!.value;
    expect(memory.records.map(({ id, sources }) => [id, sources])).toEqual([['before', copy.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id }))]]);
    expect(memory.chapters.map(({ id, sources }) => [id, sources])).toEqual([['kept', copy.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id }))]]);
    expect(memory.state.map(({ field, value, record }) => [field, value, record])).toEqual([['mood', 'calm', 'before'], ['name', 'Jin', null], ['place', 'home', 'before']]);
    expect(memory.threads.map(({ text, opened }) => [text, opened])).toEqual([['The user’s own', null], ['A vow', 'before']]);
  });
});

describe('editMessage', () => {
  it('leaves the translation outdated when only the text changed, until the translation changes too', async () => {
    const { store } = await server.account();
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: '', character: null, models: {}, note: '', prompt: crypto.randomUUID() }, projectGreetings(['하나'], [crypto.randomUUID()], 0));
    const said = crypto.randomUUID();
    await appendUserMessage(store, chat, { id: said, text: '안녕' });
    await appendTranslation(store, chat, said, { text: 'Hello', receipt: null, at: 1 }, crypto.randomUUID());
    const edit = async (text: string, translation: string) => {
      await editMessage(store, chat, fold(store.children('entry', chat)).find((message) => message.id === said)!, text, translation);
      return translationOutdated(shown(fold(store.children('entry', chat)).find((message) => message.id === said)!));
    };
    expect([await edit('안녕하세요', 'Hello'), await edit('안녕하세요', 'Hello'), await edit('안녕하세요', 'Hello there'), await edit('안녕하세요', 'Hello there')]).toEqual([true, true, false, false]);
  });
});

describe('importChat', () => {
  it('copies a chat file under new ids, folding as the source does, with its memory, illustrations and inlays and what is not here left out and counted', async () => {
    const { store, files } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const chat: Chat = { title: '기숙사의 밤', character: null, models: {}, note: '노트', prompt: crypto.randomUUID() };
    const receipt: Receipt = { id: crypto.randomUUID(), connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: 100, totalMs: 900, cache: null };
    await startChat(store, source, chat, projectGreetings(['하나', '둘', '셋'], [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()], 1));
    const said = crypto.randomUUID();
    await appendUserMessage(store, source, { id: said, text: '안녕' });
    await editMessage(store, source, fold(store.children('entry', source)).find((message) => message.id === said)!, '안녕하세요', null);
    const reply = crypto.randomUUID();
    await appendReply(store, source, { id: reply, message: null, replaces: null, at: 1, text: '답', receipt });
    await appendReply(store, source, { id: crypto.randomUUID(), message: reply, replaces: null, at: 2, text: '다른 답', receipt });
    await selectVersion(store, source, reply, reply);
    await appendTranslation(store, source, reply, { text: 'A reply', receipt: null, at: 3 }, crypto.randomUUID());
    await editMessage(store, source, fold(store.children('entry', source)).find((message) => message.id === reply)!, '답 고침', null);
    const messages = fold(store.children('entry', source));
    const sources = messages.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id }));
    await store.create('memory', { records: [{ id: 'r', sources, print: 'p', when: null, where: null, who: [], what: 'w', lines: [], outcome: '', receipt: null, at: 0, state: [], opens: [], closes: [] }], state: [], threads: [], chapters: [] }, { id: memoryId(source), parent: source });

    const picture = new Uint8Array([1, 2, 3]);
    const stored = await files.save([picture, new Uint8Array([4, 5])]);
    const scene = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };
    const sent = { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 };
    await store.create('illustration', { message: reply, version: reply, scene, receipt: null, model: { connection: 'c', model: 'm' }, sent, file: stored.ok ? stored.data[0]! : { id: '', key: '' }, type: 'image/png', size: 3, at: 4 }, { parent: source });
    await store.create('inlay', { name: 'risu-id', type: 'image/png', size: 2, file: stored.ok ? stored.data[1]! : { id: '', key: '' } }, { parent: source });

    const written = await chatFile({ store, files }, source);
    if (!written.ok) throw new Error(written.error);
    const read = readChatFile(JSON.parse(written.data));
    if (!read.ok) throw new Error(read.error);
    const imported = await importChat({ store, files }, read.file, null);
    if (!imported.ok) throw new Error(imported.error);
    const { id, dropped } = imported.data;
    expect(dropped).toEqual({ prompt: 1, persona: 0, cast: 0, models: 0, pictures: 0, inlays: 0 });
    expect(store.get('summary', summaryId(id))).not.toBeNull();
    await server.hold(store, id);
    const copy = fold(store.children('entry', id));
    const seen = (folded: Message[]) => folded.map((message) => [message.selected, message.versions.map(({ text, translation, greeting, edited }) => [text, translation?.text, greeting, edited])]);
    expect(seen(copy)).toEqual(seen(messages));
    const before = new Set(store.children('entry', source).map((entry) => entry.id));
    expect(store.children('entry', id).some((entry) => before.has(entry.id))).toBe(false);
    expect(store.get('chat', id)!.value).toEqual({ title: '기숙사의 밤', character: null, models: {}, note: '노트', seed: source });
    expect(store.get('memory', memoryId(id))!.value.records[0]!.sources).toEqual(copy.slice(0, 2).map((message) => ({ message: message.id, version: shown(message).id })));
    const [illustration] = store.children('illustration', id);
    const replied = copy.find((message) => message.versions.some(({ text }) => text === '답 고침'))!;
    expect(illustration?.value).toMatchObject({ message: replied.id, version: replied.versions.find(({ text }) => text === '답 고침')!.id });
    const opened = await files.read(illustration!.value.file);
    expect(opened.ok && [...opened.data]).toEqual([1, 2, 3]);
    const [inlay] = store.children('inlay', id);
    expect(inlay?.value).toMatchObject({ name: 'risu-id', type: 'image/png', size: 2 });
    const inlaid = await files.read(inlay!.value.file);
    expect(inlaid.ok && [...inlaid.data]).toEqual([4, 5]);

    const refusing = { save: async (bytes: unknown[]) => ({ ok: true, data: bytes.map(() => null) }) } as unknown as Files;
    const refused = await importChat({ store, files: refusing }, read.file, null);
    if (!refused.ok) throw new Error(refused.error);
    await server.hold(store, refused.data.id);
    expect([refused.data.dropped.pictures, refused.data.dropped.inlays, store.children('illustration', refused.data.id).length, store.children('inlay', refused.data.id).length]).toEqual([1, 1, 0, 0]);
  });

  it("carries every version's own continuation, not only the one shown", async () => {
    const { store, files } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    const receipt: Receipt = { id: crypto.randomUUID(), connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: 100, totalMs: 900, cache: null };
    await startChat(store, source, { title: null, character: null, models: {} }, null);
    const [said, reply] = [crypto.randomUUID(), crypto.randomUUID()];
    await appendUserMessage(store, source, { id: said, text: '하나', follows: null });
    await appendReply(store, source, { id: reply, message: null, replaces: null, follows: said, at: 1, text: '둘', receipt });
    await appendUserMessage(store, source, { id: crypto.randomUUID(), text: '셋', follows: reply });
    await appendReply(store, source, { id: crypto.randomUUID(), message: reply, replaces: null, at: 2, text: '둘 다시', receipt });

    const written = await chatFile({ store, files }, source);
    if (!written.ok) throw new Error(written.error);
    const read = readChatFile(JSON.parse(written.data));
    if (!read.ok) throw new Error(read.error);
    const imported = await importChat({ store, files }, read.file, null);
    if (!imported.ok) throw new Error(imported.error);
    await server.hold(store, imported.data.id);
    const texts = (folded: Message[]) => folded.map((message) => shown(message).text);
    const entries = store.children('entry', imported.data.id);
    expect(texts(fold(entries))).toEqual(['하나', '둘 다시']);
    expect(texts(foldTree(entries).map(({ message }) => message))).toEqual(['하나', '둘 다시', '셋']);
    const copied = fold(entries)[1]!;
    await selectVersion(store, imported.data.id, copied.id, copied.versions[0]!.id);
    expect(texts(fold(store.children('entry', imported.data.id)))).toEqual(['하나', '둘', '셋']);
  });
});

describe('채팅 로어북', () => {
  it('goes with a chat file and a branch under the copy, in its folders', async () => {
    const { store, files } = await server.account();
    const id = crypto.randomUUID();
    await server.hold(store, id);
    await startChat(store, id, { title: '등대', character: null, models: {} }, null);
    const message = crypto.randomUUID();
    await appendUserMessage(store, id, { id: message, text: '안녕' });
    await addLoreFolder(store, { kind: 'chat', id }, '장소');
    const [folder] = store.get('chat', id)!.value.loreFolders!;
    await addLore(store, id, folder!.id, crypto.randomUUID());
    const lore = (chat: string) => [store.get('chat', chat)!.value.loreFolders, store.children('lore', chat).map(({ value }) => value)];

    const written = await chatFile({ store, files }, id);
    if (!written.ok) throw new Error(written.error);
    const read = readChatFile(JSON.parse(written.data));
    if (!read.ok) throw new Error(read.error);
    const imported = await importChat({ store, files }, read.file, null);
    if (!imported.ok) throw new Error(imported.error);
    expect(lore(imported.data.id)).toEqual(lore(id));

    const branched = await copyChat(store, id, { kind: 'branch', at: message });
    if (!branched.ok) throw new Error(branched.error);
    expect(lore(branched.data.id)).toEqual(lore(id));
  });
});

describe('마스코트 대사', () => {
  it("goes with a chat file and a branch on its version's copy, and stays behind with a message the branch leaves out", async () => {
    const { store, files } = await server.account();
    const source = crypto.randomUUID();
    await server.hold(store, source);
    await startChat(store, source, { title: null, character: null, models: {} }, null);
    await appendUserMessage(store, source, { id: crypto.randomUUID(), text: '안녕' });
    const receipt: Receipt = { id: crypto.randomUUID(), connection: 'c', source: 'S', model: 'm', modelName: 'M', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: 1, totalMs: 2, cache: null };
    const [first, swipe, later] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await appendReply(store, source, { id: first, message: null, replaces: null, at: 1, text: '첫 답', receipt });
    await appendReply(store, source, { id: swipe, message: first, replaces: null, at: 2, text: '둘째 답', receipt });
    await appendUserMessage(store, source, { id: later, text: '그리고' });
    const remark = (message: string, version: string, line: string) =>
      store.create('remark', { message, version, mascot: 'yeongae', expression: 'calm', line, receipt, model: { connection: 'c', model: 'm' }, at: 3 }, { parent: source });
    await remark(first, first, '첫 줄');
    await remark(first, swipe, '둘째 줄');
    await remark(later, later, '나중 줄');
    // Each copy's line by the text of the version it names.
    const lines = (chat: string) => {
      const texts = new Map(fold(store.children('entry', chat)).flatMap((message) => message.versions.map(({ id, text }) => [`${message.id}/${id}`, text])));
      return store.children('remark', chat).map(({ value }) => [texts.get(`${value.message}/${value.version}`), value.line]).sort();
    };

    const written = await chatFile({ store, files }, source);
    if (!written.ok) throw new Error(written.error);
    const read = readChatFile(JSON.parse(written.data));
    if (!read.ok) throw new Error(read.error);
    const imported = await importChat({ store, files }, read.file, null);
    if (!imported.ok) throw new Error(imported.error);
    await server.hold(store, imported.data.id);
    expect(lines(imported.data.id)).toEqual(lines(source));

    const branched = await copyChat(store, source, { kind: 'branch', at: first });
    if (!branched.ok) throw new Error(branched.error);
    await server.hold(store, branched.data.id);
    expect(lines(branched.data.id)).toEqual([['둘째 답', '둘째 줄'], ['첫 답', '첫 줄']]);
  });
});
