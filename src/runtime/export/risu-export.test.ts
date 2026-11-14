import { expect, it, vi } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { risuChatFile } from '../../engine/import/risu-character';
import { openZip } from '../../engine/import/zip';
import { fold, type Receipt } from '../../model/chat';
import { indexZip, readEntry, type BackupOutput } from './backup-zip';
import { editCharacter, importCharacter } from '../library/characters';
import { appendReply, appendUserMessage, editMessage, setBookmark, setVariableByHand, startChat } from '../chat/chat-log';
import { projectGreetings } from '../chat/greetings';
import { exportEveryCharacter, exportRisuChat } from './risu-export';
import { testServer } from '../testing';

const server = testServer();
vi.mock('../files/picture', () => ({ thumbnail: vi.fn(async () => 'data:thumb') }));

const receipt = (): Receipt => ({ id: crypto.randomUUID(), connection: 'c1', source: 'OpenRouter', model: 'm1', modelName: 'Model One', state: 'done', cut: null, error: null, finishReason: 'stop', usage: null, cost: null, replyId: null, firstTextMs: 100, totalMs: 900, cache: null });

it('zips every character as its charx and its chats in Risu form, the line past its stages and the variables after it, an edited greeting left out and counted', async () => {
  const { store, files } = await server.account();
  const card = { ...blankCard('루나'), greetings: ['안녕', '또 왔네'], variables: [['hp', '10']] as [string, string][] };
  const character = await importCharacter(store, files, { card, lore: [], loreFolders: [], assets: [] }, null, () => {});
  const twin = await importCharacter(store, files, { card, lore: [], loreFolders: [], assets: [] }, null, () => {});
  if (!character.ok || !twin.ok) throw new Error('import');
  const greetings = () => projectGreetings(card.greetings, [crypto.randomUUID(), crypto.randomUUID()], 1);

  const chat = crypto.randomUUID();
  await server.hold(store, chat);
  await startChat(store, chat, { title: '바닷가', character: character.data.id, models: {} }, greetings());
  const said = crypto.randomUUID();
  await appendUserMessage(store, chat, { id: said, text: '{{setvar::mood::기쁨}}안녕' });
  const reply = crypto.randomUUID();
  await appendReply(store, chat, { id: reply, message: null, replaces: null, follows: said, at: 5, text: '어서 와', receipt: receipt(), reasoning: '반긴다.' });
  await appendReply(store, chat, { id: crypto.randomUUID(), message: null, replaces: null, follows: reply, at: 6, text: '', receipt: { ...receipt(), state: 'failed' } });
  await setBookmark(store, chat, reply, true, '첫 인사');
  await setVariableByHand(store, chat, reply, 'mood', '평온');

  const edited = crypto.randomUUID();
  await server.hold(store, edited);
  await startChat(store, edited, { title: null, character: twin.data.id, models: {} }, greetings());
  await editMessage(store, edited, fold(store.children('entry', edited))[0]!, '고친 인사', null);
  await appendUserMessage(store, edited, { id: crypto.randomUUID(), text: '응' });

  const chunks: Uint8Array[] = [];
  const output: BackupOutput = { write: async (bytes) => void chunks.push(bytes.slice()), close: async () => {}, abort: async () => {} };
  const signal = new AbortController().signal;
  const made = await exportEveryCharacter({ store, files }, output, signal, () => {});
  expect(made).toEqual({ ok: true, data: { greetings: 1, lore: 0, unread: 0, tools: 0 } });

  const zip = new Blob(chunks as BlobPart[]);
  const entries = await indexZip(zip, signal);
  expect([...entries.keys()].sort()).toEqual(['루나 (2).charx', '루나 (2)_all_chats.json', '루나.charx', '루나_all_chats.json']);
  const local = new DataView(await zip.slice(entries.get('루나.charx')!.offset, entries.get('루나.charx')!.offset + 8).arrayBuffer());
  expect(local.getUint16(6, true) & 0x800).toBe(0x800);
  expect(openZip(await readEntry(zip, entries.get('루나.charx')!, signal))?.read('card.json')).not.toBeNull();

  const chats = (name: string) => readEntry(zip, entries.get(name)!, signal).then((bytes) => risuChatFile(JSON.parse(new TextDecoder().decode(bytes)))!.chats);
  const [first] = await chats('루나_all_chats.json');
  expect(first).toMatchObject({ title: '바닷가', greeting: 1, variables: [['hp', '10'], ['mood', '평온']] });
  expect(first!.messages).toEqual([
    { role: 'user', text: '안녕', at: expect.any(Number) },
    { role: 'assistant', text: '어서 와', at: 5, reasoning: '반긴다.', bookmark: { name: '첫 인사' } },
  ]);
  const [twinChat] = await chats('루나 (2)_all_chats.json');
  expect(twinChat).toMatchObject({ greeting: 1, messages: [{ role: 'user', text: '응' }] });

  const one = await exportRisuChat({ store }, edited);
  expect(one.ok && one.data.left.greetings).toBe(1);

  // The card's greetings change places after the chat began: its greeting goes by where the card holds it now.
  await editCharacter(store, character.data.id, { greetings: ['또 왔네', '안녕'] });
  const swapped = await exportRisuChat({ store }, chat);
  expect(swapped.ok && [risuChatFile(JSON.parse(swapped.data.text))!.chats[0]!.greeting, swapped.data.left.greetings]).toEqual([0, 0]);
  // And one the card no longer reads as the chat does goes as an edited one, at the index the chat kept.
  await editCharacter(store, character.data.id, { greetings: ['다른 인사', '안녕'] });
  const gone = await exportRisuChat({ store }, chat);
  expect(gone.ok && gone.data.left.greetings).toBe(1);
});
