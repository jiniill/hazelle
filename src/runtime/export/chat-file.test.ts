import { describe, expect, it } from 'vitest';
import { fold, shown, type Chat, type Receipt } from '../../model/chat';
import { memoryId } from '../../model/memory';
import { chatFile, readChatFile } from './chat-file';
import { appendReply, appendTranslation, appendUserMessage, selectVersion, setVariableByHand, startChat } from '../chat/chat-log';
import { testServer } from '../testing';

const server = testServer();
const receipt: Receipt = { id: 'call', connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: 100, totalMs: 900, cache: null };

async function savedChat() {
  const { store, files } = await server.account();
  const id = crypto.randomUUID();
  await server.hold(store, id);
  const chat: Chat = { title: '밤', character: null, models: {} };
  await startChat(store, id, chat, null);
  const said = crypto.randomUUID();
  await appendUserMessage(store, id, { id: said, text: '안녕' });
  const reply = crypto.randomUUID();
  await appendReply(store, id, { id: reply, message: null, replaces: null, at: 1, text: '첫 답', receipt });
  const swipe = crypto.randomUUID();
  await appendReply(store, id, { id: swipe, message: reply, replaces: null, at: 2, text: '둘째 답', receipt });
  await selectVersion(store, id, reply, reply);
  await appendTranslation(store, id, reply, { text: 'First reply', receipt: null, at: 3 }, crypto.randomUUID());
  await setVariableByHand(store, id, said, 'mood', 'calm');
  await store.create('memory', { records: [], state: [{ about: 'Luna', field: 'mood', value: 'calm', record: null }], threads: [], chapters: [] }, { id: memoryId(id), parent: id });
  return { store, files, id };
}

const written = async (session: Awaited<ReturnType<typeof savedChat>>) => {
  const made = await chatFile(session, session.id);
  if (!made.ok) throw new Error(made.error);
  return JSON.parse(made.data) as { rows: { id: string; parent: string | null }[]; version: number };
};

describe('chat file', () => {
  it('reads back as the chat folds here, its memory with it', async () => {
    const saved = await savedChat();
    const { store, id } = saved;
    const read = readChatFile(await written(saved));
    if (!read.ok) throw new Error(read.error);
    expect(read.file.chat.id).toBe(id);
    expect(fold(read.file.entries)).toEqual(fold(store.children('entry', id)));
    expect(shown(fold(read.file.entries)[0]!).byHand).toEqual([['mood', 'calm']]);
    expect(read.file.memory?.value.state).toEqual([{ about: 'Luna', field: 'mood', value: 'calm', record: null }]);
    // A chat with no 마스코트 대사, as every file written before them is, reads with none.
    expect(read.file.remarks).toEqual([]);
  });

  it('refuses another format or version, a file without pictures, a row that is not stored, a second chat, and a row of another chat', async () => {
    const file = await written(await savedChat());
    const [chat, entry] = file.rows;
    expect(readChatFile({ ...file, format: 'risu-alpha-backup' })).toEqual({ ok: false, error: 'not-chat-file' });
    expect(readChatFile({ ...file, version: 2 })).toEqual({ ok: false, error: 'other-version' });
    expect(readChatFile({ ...file, pictures: undefined })).toEqual({ ok: false, error: 'not-chat-file' });
    expect(readChatFile({ ...file, rows: [...file.rows, { ...entry, rev: 'one' }] })).toEqual({ ok: false, error: 'not-chat-file' });
    expect(readChatFile({ ...file, rows: [...file.rows, { ...chat, id: crypto.randomUUID() }] })).toEqual({ ok: false, error: 'not-chat-file' });
    expect(readChatFile({ ...file, rows: [...file.rows, { ...entry, id: crypto.randomUUID(), parent: crypto.randomUUID() }] })).toEqual({ ok: false, error: 'not-chat-file' });
  });
});
