import { textFileNames } from '../engine/assets';
import { fileStem } from '../engine/file-name';
import { RISU_ALL_CHATS, risuChat, risuChatJson } from '../engine/import/risu-chat';
import type { Json } from '../engine/import/convert';
import { chatTitle, shown } from '../model/chat';
import { live } from '../model/library';
import type { ApiFailure, ApiResult } from './api';
import { BackupZip, bufferedBackupOutput, type BackupOutput } from './backup-zip';
import { charxContent, lorebookOf, writeCharxFile, type ExportStep } from './card-file';
import { scopeOf } from './chat-context';
import { evaluationFailure } from './evaluation';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { summaryId } from './summary';
import { toBase64 } from '../vault/aead';

type Reader = Pick<Session, 'store'>;

// Count unsupported exports: edited greetings fall back to card greetings (user, 2026-10-15),
// lore counts non-round-trippable entries, unread counts unopenable/stuck chats.
export type LeftOut = { greetings: number; lore: number; unread: number };
const NOTHING_LEFT: LeftOut = { greetings: 0, lore: 0, unread: 0 };
const plus = (a: LeftOut, b: LeftOut): LeftOut => ({ greetings: a.greetings + b.greetings, lore: a.lore + b.lore, unread: a.unread + b.unread });

const encoder = new TextEncoder();

// The chat must be loaded. Its line as the screen shows it, each text past its input or output stage at the prompt's
// stage: the display's would carry its comments and pictures as HTML.
async function lineOf({ store }: Reader, id: string): Promise<ApiResult<{ chat: Json; left: LeftOut }>> {
  const stored = live(store.get('chat', id));
  if (!stored) return { ok: false, error: 'gone' };
  const chat = stored.value;
  const { messages } = store.foldedChat(id);
  const scope = scopeOf({ store }, id, chat, messages);
  const lane = { asker: 'export', chat: id } as const;
  let state;
  try {
    state = await store.evaluation.state(lane, scope, '');
  } catch (error) {
    return evaluationFailure(error);
  } finally {
    store.evaluation.forget(lane);
  }
  if ('kind' in state) return { ok: false, error: 'bot-stuck' };
  // A greeting slot opens the line whether or not it shows a card greeting now (greetingOf): a blank one shown, or a
  // version the model wrote over it, goes as an edited one does.
  const opening = messages[0]?.role === 'assistant' && messages[0].versions[0]!.greeting !== undefined;
  const greeting = scope.greeting?.index ?? null;
  const edited = opening && (greeting === null || shown(messages[0]!).edited);
  const lore = lorebookOf(store, id, chat.loreFolders ?? []);
  // Risu carries a text file inside the message as its own {{file::name::base64}}. The stages have read the message's
  // tags away (cbs/tags.ts), so they are found in the text as stored and lead the message, as the composer put them.
  const files = new Map(scope.textfiles.map((file) => [file.name, file]));
  const risuFiles = (stored: string) => textFileNames(stored).flatMap((name) => files.get(name) ?? []).map(({ title, text }) => `{{file::${title.replace(/[:{}]/g, '_')}::${toBase64(encoder.encode(text))}}}`).join('');
  const line = messages.flatMap((message, index) => {
    if (opening && index === 0) return [];
    const version = shown(message);
    // A failed reply is no part of the story, as the 아카라이브 log leaves it out.
    if (version.receipt?.state === 'failed') return [];
    const text = version.staged ? version.text : state.staged[index]!;
    const filed = risuFiles(version.text);
    return [{ id: message.id, role: message.role, text: filed ? filed + text.trimStart() : text, at: version.at, ...(version.reasoning && { reasoning: version.reasoning }) }];
  });
  const written = risuChat({
    id: crypto.randomUUID(),
    title: chatTitle(chat, messages, state.staged),
    note: chat.note ?? '',
    greeting: opening ? greeting : null,
    messages: line,
    variables: state.variables,
    bookmarks: chat.bookmarks ?? [],
    ...lore,
  });
  return { ok: true, data: { chat: written.chat, left: { greetings: edited ? 1 : 0, lore: written.unheld, unread: 0 } } };
}

export async function exportRisuChat(reader: Reader, id: string): Promise<ApiResult<{ text: string; left: LeftOut }>> {
  const made = await reader.store.withChat(id, () => lineOf(reader, id));
  return made.ok ? { ok: true, data: { text: risuChatJson(made.data.chat), left: made.data.left } } : made;
}

// A character's live chats, newest first by their last message: Risu puts a file's chats in front of its list in
// file order, so the newest lands on top. One whose summary is not made yet goes last.
function chatsOf(store: ObjectStore, character: string): string[] {
  const at = (id: string) => store.get('summary', summaryId(id))?.value.at ?? 0;
  return store
    .list('chat')
    .filter((chat) => live(chat) && chat.value.character === character)
    .map(({ id }) => id)
    .sort((a, b) => at(b) - at(a));
}

// Each chat is opened, written and let go in turn, so the file never sits whole in memory. A chat that cannot be read
// or whose bot does not end is passed over and counted; any other failure ends it.
async function writeChats(reader: Reader, chats: string[], write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>, signal: AbortSignal | undefined, progress: (step: ExportStep) => void): Promise<ApiResult<LeftOut>> {
  let left = NOTHING_LEFT;
  let first = true;
  await write(encoder.encode(RISU_ALL_CHATS.head));
  for (const [done, id] of chats.entries()) {
    progress({ done, total: chats.length });
    const read = await reader.store.withChats([id], (readable, [passed]) => (readable.length > 0 ? lineOf(reader, id) : Promise.resolve(passed!)), { signal, summarize: false });
    if (!read.ok && (read.error === 'bot-stuck' || read.error === 'unreadable')) {
      left = plus(left, { ...NOTHING_LEFT, unread: 1 });
      continue;
    }
    if (!read.ok) return read;
    await write(encoder.encode(`${first ? '' : ','}${JSON.stringify(read.data.chat)}`));
    first = false;
    left = plus(left, read.data.left);
  }
  progress({ done: chats.length, total: chats.length });
  await write(encoder.encode(RISU_ALL_CHATS.tail));
  return { ok: true, data: left };
}

const writeFailure = (signal: AbortSignal | undefined): ApiFailure => ({ ok: false, error: signal?.aborted ? 'stopped' : 'export-write' });

// A character's live chats as Risu's risuAllChats file.
export async function exportRisuChats(reader: Reader, character: string, output: BackupOutput, progress: (step: ExportStep) => void): Promise<ApiResult<LeftOut>> {
  let complete = false;
  try {
    const written = await writeChats(reader, chatsOf(reader.store, character), (bytes) => output.write(bytes), undefined, progress);
    if (!written.ok) return written;
    await output.close();
    complete = true;
    return written;
  } catch {
    return writeFailure(undefined);
  } finally {
    if (!complete) await output.abort();
  }
}

// Every live character as a zip of its charx and its chats' risuAllChats file, which only the user's OS opens: Risu
// loads the files one by one. ZIP64 with data descriptors (ruled 2026-10-15), so it may pass 4 GiB and 65,535 files,
// and each entry streams in as it is made. A character with no chats has no chat file. tools: modules left out of
// the charx files for holding a tool.
export async function exportEveryCharacter(reader: Pick<Session, 'store' | 'files'>, output: BackupOutput, signal: AbortSignal, progress: (step: ExportStep) => void): Promise<ApiResult<LeftOut & { tools: number }>> {
  const { store, files } = reader;
  const characters = store
    .list('character')
    .flatMap((stored) => (live(stored) ? [{ id: stored.id, name: stored.value.card.name }] : []))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const buffered = bufferedBackupOutput(output, signal);
  const zip = new BackupZip(buffered, signal);
  const taken = new Map<string, number>();
  let left = NOTHING_LEFT;
  let tools = 0;
  let complete = false;
  try {
    for (const [done, { id, name }] of characters.entries()) {
      progress({ done, total: characters.length });
      const content = charxContent(store, id);
      if (!content.ok) continue;
      // Two characters of one name each keep their pair apart, the second as name (2).
      const stem = fileStem(name, '캐릭터');
      const count = (taken.get(stem) ?? 0) + 1;
      taken.set(stem, count);
      const base = count === 1 ? stem : `${stem} (${count})`;
      const push = await zip.entry(`${base}.charx`, false);
      // The charx's own failure ends the whole zip, which the finally below aborts; one entry cannot be taken back.
      const entry: BackupOutput = { write: (bytes) => push(bytes), close: () => push(new Uint8Array(0), true), abort: async () => {} };
      const charx = await writeCharxFile(content.data, (ref) => files.read(ref, { bulk: true }), entry, () => {});
      if (!charx.ok) return charx.error === 'export-write' ? writeFailure(signal) : charx;
      tools += content.data.tools;
      const chats = chatsOf(store, id);
      if (chats.length === 0) continue;
      const json = await zip.entry(`${base}_all_chats.json`, true);
      const written = await writeChats(reader, chats, (bytes) => json(bytes), signal, () => {});
      if (!written.ok) return written;
      await json(new Uint8Array(0), true);
      left = plus(left, written.data);
    }
    progress({ done: characters.length, total: characters.length });
    await zip.end();
    await buffered.close();
    complete = true;
    return { ok: true, data: { ...left, tools } };
  } catch {
    return writeFailure(signal);
  } finally {
    if (!complete) await buffered.abort();
  }
}
