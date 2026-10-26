import type { Cost } from '../connectors/types';
import type { RisuMessage } from '../engine/import/types';
import { memoryThrough } from '../engine/memory';
import { VARIABLE_LIMITS } from '../engine/render';
import { CAST_MAX, foldTree, shown, standing, translationOutdated, type AgentRun, type Bookmark, type Chat, type ChatItem, type Entry, type Message, type Receipt, type Translation, type Version, type Writes } from '../model/chat';
import { cachePrintId } from '../model/cache';
import type { Illustration } from '../model/illustration';
import type { Remark } from '../model/mascot';
import { live, type Asset, type Lore, type TextFile } from '../model/library';
import { memoryId, type Memory, type Source } from '../model/memory';
import type { Badges } from '../model/tool';
import type { ApiFailure, ApiResult } from './api';
import { routeOf } from './assignment';
import { chatPrint } from './cache';
import type { ChatFile } from './chat-file';
import type { Session } from './session';
import { storedMemory } from './memory-read';
import { markDeleted } from './removal';
import type { Greetings } from './greetings';
import { withPersona } from './personas';
import { toolChatId } from './tools/store';
import { without } from '../model/fields';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';
import { chatPlace, costRow, receiptRow } from './usage';

// The only writer of `chat` and `entry` objects, except a chat's `models` layer, which runtime/assignment writes with
// the other layers, its lorebook's folders, which runtime/lore writes as every lorebook's, a purge (runtime/characters), which claims a deleted chat and removes it with all it owns, or with
// its character, a backup's restore, which copies them as they were, and a move from Risu, which saves chatWrites'
// entries before its character and the chat root with it (runtime/characters addCharacter). An imported chat file or
// Risu chat file (importChat here, importRisuChats in runtime/move) is saved through saveNewChats.

// A new chat is saved in this order: the chat with its greetings, the one shown selected, then the user's first
// message, which continues the greeting shown (model/chat Entry follows), sent with its reply. The chat and its
// greetings are one batch, which writes the greetings first, so the chat is never there without them: its screen would
// show it greeting-less until they landed.
// id is the one the chat was shown under before it was saved, which seeds its greeting's pick and rollp tags.
export async function startChat(store: ObjectStore, id: string, chat: Chat, greetings: Greetings | null): Promise<ApiFailure | null> {
  const { entries, root } = chatWrites(id, withPersona(store, chat), greetings, []);
  const saved = await store.batch([...entries, root]);
  return saved.ok ? null : saved;
}

// A new chat's writes: its greetings, then the messages it already holds (a chat brought from Risu), in the order they
// fold, and its root, which is written with or after them.
export function chatWrites(id: string, chat: Chat, greetings: Greetings | null, messages: RisuMessage[]): { entries: Write[]; root: Write } {
  // A moved chat's greeting takes its first message's time, so it does not read as newer than what follows it.
  const entries = greetings ? greetingWrites(id, greetings, messages[0]?.at ?? Date.now()) : [];
  let follows = greetings ? greetings.choices[greetings.selected]!.id : null;
  const bookmarks: Bookmark[] = [];
  for (const { role, text, at, reasoning, bookmark } of messages) {
    const message = crypto.randomUUID();
    entries.push({ type: 'create', kind: 'entry', id: message, parent: id, value: { type: 'message', role, at, text, receipt: null, follows, staged: true, ...(reasoning && { reasoning }) } });
    if (bookmark) bookmarks.push({ message, ...bookmark });
    follows = message;
  }
  return { entries, root: { type: 'create', kind: 'chat', id, parent: null, value: withBookmarks(chat, bookmarks) } };
}

// Greetings are saved as the card wrote them; engine/render fills them each time they are shown or sent.
function greetingWrites(chat: string, { choices, selected }: Greetings, at: number): Write[] {
  const first = choices[0]!.id;
  const entries: [string, Entry][] = choices.map(({ id, index: greeting, text, translation }, index) => {
    const common = { at, text, receipt: null, greeting, ...(translation && { translation }) };
    return [id, index === 0 ? { type: 'message', role: 'assistant', follows: null, ...common } : { type: 'version', message: first, replaces: null, edit: false, ...common }];
  });
  // Adding a version selects it, so without a select the chat would open on the last greeting.
  if (selected !== choices.length - 1) entries.push([crypto.randomUUID(), { type: 'select', message: first, version: choices[selected]!.id, at }]);
  return entries.map(([id, value]) => ({ type: 'create', kind: 'entry', id, parent: chat, value }));
}

// The spread takes the original's own choices; nothing links the two chats but origin, so deleting either leaves the
// other whole. messages, versions: each copy's id by the original's. The cache print goes too: the branch sends the
// same prefix from the same account, so its first send reads the original's cache; it counts only while the print's
// call is the branch's latest (cache prior), as when it is cut at the last reply.
export async function branchChat(store: ObjectStore, item: ChatItem, message: string): Promise<ApiResult<Hazelle.Branched & { id: string }>> {
  return store.withChat(item.id, async () => {
    const current = store.projections.get(item.id)?.model;
    if (!current) return { ok: false, error: 'gone' };
    item = current;
    const upTo = item.messages.findIndex((candidate) => candidate.id === message);
    if (upTo === -1) return { ok: false, error: 'gone' };
    const id = crypto.randomUUID();
    const memory = storedMemory(store, item.id)?.value;
    const illustrations = store.children('illustration', item.id).map(({ value }) => value);
    const remarks = store.children('remark', item.id).map(({ value }) => value);
    const inlays = store.children('inlay', item.id).map(({ value }) => value);
    const textfiles = store.children('textfile', item.id).map(({ value }) => value);
    const lore = store.children('lore', item.id).map(({ value }) => value);
    const line = item.messages.slice(0, upTo + 1).map((each, index, all) => ({ message: each, follows: index === 0 ? null : shown(all[index - 1]!).id }));
    const { writes, after, messages, versions } = copyWrites(id, line, memory, illustrations, remarks, inlays, textfiles, lore);
    writes.push(...(await branchToolData(store, item.id, id, messages, versions)));
    const print = chatPrint(store, item.id);
    if (print) writes.push({ type: 'create', kind: 'cacheprint', id: cachePrintId(id), parent: id, value: print.value });
    const chat = withBookmarks(item.chat, carried(item.chat.bookmarks, messages));
    writes.push({ type: 'create', kind: 'chat', id, parent: null, value: { ...chat, title: null, origin: { id: item.id, name: item.title, after }, seed: item.chat.seed ?? item.id } });
    const created = await store.batch(writes);
    return created.ok ? { ok: true, data: { id, from: item.id, messages: Object.fromEntries(messages), versions: Object.fromEntries(versions) } } : created;
  });
}

// What a chat file's chat named that this account does not hold live, by kind; models counts roles. pictures, inlays:
// the illustrations and the inlays whose picture the server refused.
export type Dropped = { prompt: number; persona: number; cast: number; models: number; pictures: number; inlays: number };

// A chat file's chat, copied under new ids as a branch is, to character. What it names that is not live here is
// left out and counted, so the chat follows the default there; a persona left out gives the one a new chat takes.
// Its pictures are saved first, each under the reference its bytes seal to here; one the server refuses leaves out
// the illustrations and inlays that show it, as a picture an import cannot read is.
export async function importChat({ store, files }: Pick<Session, 'store' | 'files'>, file: ChatFile, character: string | null): Promise<ApiResult<{ id: string; dropped: Dropped }>> {
  const id = crypto.randomUUID();
  const ids = [...file.pictures.keys()];
  const saved = await files.save(ids.map((each) => file.pictures.get(each)!), { bulk: true });
  if (!saved.ok) return saved;
  const refs = new Map(ids.map((each, index) => [each, saved.data[index]]));
  const resealed = <V extends { file: { id: string } }>(values: V[]) => values.flatMap((value) => {
    const ref = refs.get(value.file.id);
    return ref ? [{ ...value, file: ref }] : [];
  });
  const illustrations = resealed(file.illustrations.map(({ value }) => value));
  const inlays = resealed(file.inlays.map(({ value }) => value));
  const { writes, messages } = copyWrites(id, foldTree(file.entries), file.memory?.value, illustrations, file.remarks.map(({ value }) => value), inlays, file.textfiles.map(({ value }) => value), file.lore.map(({ value }) => value));
  const { prompt, persona, cast = [], models, origin, bookmarks, ...value } = without(without(file.chat.value, 'deleted'), 'purging');
  const held = (kind: 'prompt' | 'persona' | 'character' | 'chat', ref: string | undefined): ref is string => ref !== undefined && live(store.get(kind, ref)) !== null;
  const kept = cast.filter((each) => held('character', each));
  const roles = Object.entries(models).filter(([, ref]) => ref && !('kind' in routeOf(store, ref)));
  const after = origin && messages.get(origin.after);
  const chat: Chat = {
    ...value,
    character,
    models: Object.fromEntries(roles),
    seed: value.seed ?? file.chat.id,
    ...(held('prompt', prompt) && { prompt }),
    ...(held('persona', persona) && { persona }),
    ...(origin && after && held('chat', origin.id) && { origin: { ...origin, after } }),
  };
  const dropped = {
    prompt: Number(prompt !== undefined && chat.prompt === undefined),
    persona: Number(persona !== undefined && chat.persona === undefined),
    cast: cast.length - kept.length,
    models: Object.keys(models).length - roles.length,
    pictures: file.illustrations.length - illustrations.length,
    inlays: file.inlays.length - inlays.length,
  };
  writes.push({ type: 'create', kind: 'chat', id, parent: null, value: withBookmarks(withCast(withPersona(store, chat), character, kept), carried(bookmarks, messages)) });
  const failure = await saveNewChats(store, [id], writes);
  return failure ?? { ok: true, data: { id, dropped } };
}

// Chats written here for the first time, each root after what it owns: held while they land and summarized before
// this answers, so the list shows them at once. landed: what goes after the batch and before the summaries, which read
// it; a move saves its character there, with the chat roots.
export async function saveNewChats(
  store: ObjectStore,
  chats: string[],
  writes: Write[],
  { written, landed }: { written?: (write: Write) => void; landed?: () => Promise<ApiFailure | null> } = {},
): Promise<ApiFailure | null> {
  const leases = chats.map((chat) => store.retainChat(chat, { created: true }));
  try {
    for (const lease of leases) {
      const failure = await lease.ready;
      if (failure) return failure;
    }
    const saved = await store.batch(writes, written, { unheld: true });
    if (!saved.ok) return saved;
    const failure = await landed?.();
    if (failure) return failure;
    return await store.projections.saveMany(chats);
  } finally {
    for (const lease of leases) lease.release();
  }
}

// source: parents before what continues them. messages, versions: each copy's id by the original's. after: the last
// copy's id.
function copyWrites(id: string, source: { message: Message; follows: string | null }[], memory: Memory | undefined, illustrations: Illustration[], remarks: Remark[], inlays: Asset[], textfiles: TextFile[], lore: Lore[]): { writes: Write[]; messages: Map<string, string>; versions: Map<string, string>; after: string } {
  let after = '';
  const writes: Write[] = [];
  const messages = new Map<string, string>();
  const versions = new Map<string, string>();
  for (const { message, follows } of source) {
    after = crypto.randomUUID();
    messages.set(message.id, after);
    const copy = copied(after, message, follows === null ? null : versions.get(follows)!);
    for (const [old, made] of copy.versions) versions.set(old, made);
    for (const [entryId, entry] of copy.entries) {
      writes.push({ type: 'create', kind: 'entry', id: entryId, parent: id, value: entry });
    }
  }
  const kept = memory && branchMemory(memory, messages, versions);
  if (kept) writes.push({ type: 'create', kind: 'memory', id: memoryId(id), parent: id, value: kept });
  const standingIds = standing(source.map(({ message }) => message));
  for (const illustration of illustrations) {
    const standsAs = standingIds.get(illustration.version);
    const [message, version] = [messages.get(illustration.message), standsAs && versions.get(standsAs)];
    if (message && version) writes.push({ type: 'create', kind: 'illustration', id: crypto.randomUUID(), parent: id, value: { ...illustration, message, version } });
  }
  for (const remark of remarks) {
    const [message, version] = [messages.get(remark.message), versions.get(remark.version)];
    if (message && version) writes.push({ type: 'create', kind: 'remark', id: crypto.randomUUID(), parent: id, value: { ...remark, message, version } });
  }
  for (const inlay of inlays) writes.push({ type: 'create', kind: 'inlay', id: crypto.randomUUID(), parent: id, value: inlay });
  for (const textfile of textfiles) writes.push({ type: 'create', kind: 'textfile', id: crypto.randomUUID(), parent: id, value: textfile });
  for (const entry of lore) writes.push({ type: 'create', kind: 'lore', id: crypto.randomUUID(), parent: id, value: entry });
  return { writes, messages, versions, after };
}

// The tools' data for the chat goes with a branch as it stands, each key at the branch's own address. The badges the
// host keeps follow their messages; references inside a tool's own data are the tool's to remap (its branch event).
// A chat file carries none: its modules are another account's.
async function branchToolData(store: ObjectStore, from: string, to: string, messages: ReadonlyMap<string, string>, versions: ReadonlyMap<string, string>): Promise<Write[]> {
  return Promise.all(store.children('toolchat', from).flatMap(({ value: { module, key, value } }) => {
    const badges = key === null && Object.entries(value as Badges).flatMap(([message, { version, text }]) => (messages.has(message) ? [[messages.get(message)!, { version: versions.get(version) ?? version, text }]] : []));
    if (badges && !badges.length) return [];
    return [toolChatId(module, to, key).then((id): Write => ({ type: 'create', kind: 'toolchat', id, parent: to, value: { module, key, value: badges ? Object.fromEntries(badges) : value } }))];
  }));
}

// The records whose every message lies before the split, their sources remapped to the branch's messages and versions
// (a version the branch does not hold keeps its old id, so the record stays stale there too), with the facts and threads
// as they stood with only those records (engine/memory memoryThrough). A record across the split stays behind, and its
// messages stay raw in the branch until its own summarizing reaches them. A chapter goes with its records and its
// messages, all of them: one made again past a deleted record still reads that record's messages. null: nothing to carry.
function branchMemory(memory: Memory, messages: ReadonlyMap<string, string>, versions: ReadonlyMap<string, string>): Memory | null {
  const remap = ({ message, version }: Source): Source => ({ message: messages.get(message)!, version: versions.get(version) ?? version });
  const kept = memoryThrough(memory, memory.records.filter(({ sources }) => sources.every(({ message }) => messages.has(message))));
  const records = kept.records.map((record) => ({ ...record, sources: record.sources.map(remap) }));
  const chapters = kept.chapters.filter(({ sources }) => sources.every(({ message }) => messages.has(message))).map((chapter) => ({ ...chapter, sources: chapter.sources.map(remap) }));
  return records.length || kept.state.length || kept.threads.length ? { ...kept, records, chapters } : null;
}

// The entries that fold back to message under the id given: its first version as the message entry, and that
// version again in its own place when it is an edit or came later than the message, which a message entry cannot
// hold; the other versions; and a select when the one shown is not the last, since adding a version selects it.
// versions: each version's id in the branch, by its id here.
// A field added to messages must be written here too, or a branch drops it, as must a kind a chat holds
// (copyWrites, branchToolData).
function copied(id: string, { role, at, versions, selected, after }: Message, follows: string | null): { entries: [string, Entry][]; versions: Map<string, string> } {
  const ids = versions.map((_, index) => (index === 0 ? id : crypto.randomUUID()));
  const [first, ...rest] = versions;
  // The first version said again holds its own writes: an edit would add them to the message entry's.
  const repeated = first!.edited || first!.at !== at;
  const entries: [string, Entry][] = [[id, { type: 'message', role, at, follows, ...held(repeated ? { ...first!, before: undefined } : first!) }]];
  const made = new Map(versions.map((version, index) => [version.id, ids[index]!]));
  if (repeated) {
    const again = crypto.randomUUID();
    made.set(first!.id, again);
    entries.push([again, { type: 'version', message: id, replaces: id, edit: first!.edited, at: first!.at, ...held(first!) }]);
  }
  rest.forEach((version, index) => {
    entries.push([ids[index + 1]!, { type: 'version', message: id, replaces: null, edit: version.edited, at: version.at, ...held(version) }]);
  });
  if (selected !== versions.length - 1) entries.push([crypto.randomUUID(), { type: 'select', message: id, version: ids[selected]!, at: versions[selected]!.at }]);
  for (const version of versions) if (version.after) entries.push([crypto.randomUUID(), { type: 'vars', version: made.get(version.id)!, set: version.after, at: version.at }]);
  for (const version of versions) if (version.byHand) entries.push([crypto.randomUUID(), { type: 'vars', version: made.get(version.id)!, set: version.byHand, at: version.at, byHand: true }]);
  for (const version of versions) for (const [agent, memory] of Object.entries(version.memories ?? {})) entries.push([crypto.randomUUID(), { type: 'agentMemory', version: made.get(version.id)!, agent, memory, at: version.at }]);
  if (after) entries.push([crypto.randomUUID(), { type: 'vars', version: made.get(versions[selected]!.id)!, set: after, at, stays: true }]);
  return { entries, versions: made };
}

// What a copy of a version carries. A field added to versions must be written here too, or a copy drops it. The calls
// the bot's Lua made (Version.calls) are dropped on purpose: usage counts a call where it was made.
const held = ({ text, receipt, seed, translation, staged, before, reasoning, greeting, raw }: Version) => ({ text, receipt, seed, ...(translation && { translation }), ...(staged && { staged }), ...(before && { before }), ...(reasoning && { reasoning }), ...(greeting !== undefined && { greeting }), ...(raw !== undefined && { raw }) });

// A new last version of the message, a copy of the one shown, which it shows: what followed the one shown stays that
// version's continuation (Entry follows), so a line written after the copy leaves the story before it a switch away.
export function copyShown(store: ObjectStore, chat: string, message: Message) {
  const current = shown(message);
  const id = crypto.randomUUID();
  // Pictures and remarks name a version (an illustration any id it stood under), so the copy gets its own rows, as a
  // branch gives them (copyWrites); without them the copy shows the reply bare.
  const stood = new Set([...(current.earlier ?? []), current.id]);
  const shownRows = (kind: 'illustration' | 'remark'): Write[] =>
    store
      .children(kind, chat)
      .filter(({ value }) => value.message === message.id && stood.has(value.version))
      .map(({ value }) => ({ type: 'create', kind, id: crypto.randomUUID(), parent: chat, value: { ...value, version: id } }));
  return store.batch([
    entryRow(chat, { type: 'version', message: message.id, replaces: null, edit: current.edited, at: current.at, ...held(current) }, id),
    ...(current.after ? [entryRow(chat, { type: 'vars', version: id, set: current.after, at: current.at })] : []),
    ...shownRows('illustration'),
    ...shownRows('remark'),
  ]);
}

// A blank name gives the chat back its first message as its name.
export const renameChat = (store: ObjectStore, id: string, name: string) => store.update('chat', id, (current) => ({ ...current, title: name.trim() || null }));

// The chat stays whole, read as gone (model/library live), until purgeExpired removes it with all it owns; restoreChat
// (되돌리기) brings it back until then.
export const removeChat = (store: ObjectStore, id: string) => markDeleted(store, 'chat', id, Date.now());

export const restoreChat = (store: ObjectStore, id: string) => markDeleted(store, 'chat', id, null);

export type Own = 'prompt' | 'persona' | 'note' | 'illustrateNote';

// null clears it, and the chat follows the default again.
export const withOwn = <T extends Pick<Chat, Own>>(chat: T, field: Own, value: string | null): T => (value === null ? without(chat, field) : { ...chat, [field]: value });

export const setChatOwn = (store: ObjectStore, chat: string, field: Own, value: string | null) => store.update('chat', chat, (current) => withOwn(current, field, value));

export function withCast<T extends Pick<Chat, 'cast'>>(chat: T, character: string | null, ids: string[]): T {
  const cast = [...new Set(ids)].filter((id) => id !== character).slice(0, CAST_MAX);
  return cast.length ? { ...chat, cast } : without(chat, 'cast');
}

export const setCast = (store: ObjectStore, chat: string, ids: string[]) => store.update('chat', chat, (current) => withCast(current, current.character, ids));

const withBookmarks = <T extends Pick<Chat, 'bookmarks'>>(chat: T, bookmarks: Bookmark[]): T => (bookmarks.length ? { ...chat, bookmarks } : without(chat, 'bookmarks'));

// A copy's bookmarks: those of the messages it copied, under their copies' ids.
const carried = (bookmarks: Bookmark[] = [], messages: ReadonlyMap<string, string>) =>
  bookmarks.flatMap((bookmark) => (messages.has(bookmark.message) ? [{ ...bookmark, message: messages.get(bookmark.message)! }] : []));

// on, not a flip: a conflict applies the change again to the copy it lost to. name: the one an undone unmark puts back;
// without it a bookmark already there keeps its own.
export const setBookmark = (store: ObjectStore, chat: string, message: string, on: boolean, name?: string) =>
  store.update('chat', chat, (current) => {
    const bookmarks = current.bookmarks ?? [];
    const others = bookmarks.filter((bookmark) => bookmark.message !== message);
    if (!on) return withBookmarks(current, others);
    const kept = bookmarks.find((bookmark) => bookmark.message === message);
    const mark = name === undefined ? (kept ?? { message }) : { message, name };
    return withBookmarks(current, kept ? bookmarks.map((bookmark) => (bookmark === kept ? mark : bookmark)) : [...bookmarks, mark]);
  });

export const nameBookmark = (store: ObjectStore, chat: string, message: string, name: string) =>
  store.update('chat', chat, (current) => {
    const bookmarks = current.bookmarks ?? [];
    if (!bookmarks.some((bookmark) => bookmark.message === message)) return null;
    const named = (bookmark: Bookmark): Bookmark => (name.trim() ? { ...bookmark, name: name.trim() } : without(bookmark, 'name'));
    return { ...current, bookmarks: bookmarks.map((bookmark) => (bookmark.message === message ? named(bookmark) : bookmark)) };
  });

// Every message a version switch can show, for the bookmarks off the line shown (app/chat/bookmarks).
export const versionTree = (store: ObjectStore, chat: string) => foldTree(store.children('entry', chat));

// rows: the ledger rows of the calls the entry is the first to save (runtime/usage), written with it.
const entryRow = (chat: string, entry: Entry, id: string = crypto.randomUUID()): Write => ({ type: 'create', kind: 'entry', id, parent: chat, value: entry });

const append = (store: ObjectStore, chat: string, entry: Entry, id?: string, rows: Write[] = []) =>
  rows.length ? store.batch([entryRow(chat, entry, id), ...rows]) : store.create('entry', entry, { id, parent: chat });

const translationRows = (store: ObjectStore, chat: string, translation?: Translation) =>
  (translation?.receipt ? [receiptRow(translation.receipt, translation.at, chatPlace(store, chat))] : []);

// translation: what the user typed, when text is its translation sent. before: what the bot's Lua wrote as it was
// sent; follows: the version it continues, absent only on a message from a call begun before follows (model/chat Entry).
export type Said = { id: string; text: string; follows?: string | null; translation?: Translation; before?: Writes };

export const appendUserMessage = (store: ObjectStore, chat: string, { id, text, follows, translation, before }: Said) =>
  append(store, chat, { type: 'message', role: 'user', at: Date.now(), text, receipt: null, ...(follows !== undefined && { follows }), ...(translation && { translation }), ...(before && { before }) }, id, translationRows(store, chat, translation));

// at is the reply's own, never the time of the save, so saving it again (Talk.saveAgain) sends the same entry, and a
// first try that landed unanswered is found as it is.
export type Written = { id: string; message: string | null; replaces: string | null; follows?: string | null; at: number; text: string; receipt: Receipt; seed?: string; before?: Writes; reasoning?: string };

export function appendReply(store: ObjectStore, chat: string, { id, message, replaces, follows, at, text, receipt, seed, before, reasoning }: Written) {
  const held = { at, text, receipt, ...(before && { before }), ...(reasoning && { reasoning }) };
  // A continued reply's receipt carries the one it continued, whose row its own save wrote.
  return append(store, chat, message === null ? { type: 'message', role: 'assistant', ...(follows !== undefined && { follows }), ...held } : { type: 'version', message, replaces, edit: false, ...held, ...(seed && { seed }) }, id, [receiptRow(receipt, at, chatPlace(store, chat))]);
}

// edits: a message's new text in place of its shown version, with the variables that version's own text wrote, which
// the new text no longer does. added: messages, the first continuing follows (model/chat Entry), each other the one
// added before it. vars: the variables written, standing after a version, or with stays after its message
// (Entry vars).
export type Scripted = {
  edits: { message: Message; text: string; wrote: Writes }[];
  removed: string[];
  // ahead: the saved message that then continues the run's last (a bot's insertChat); null for a run after the last.
  added: { follows: string | null; ahead: Message | null; messages: { role: 'user' | 'assistant'; text: string }[] }[];
  vars: { version: string; set: Writes; stays?: true } | null;
};

// One batch, so a run's changes land together. What Lua writes is already past the input and output scripts.
export function appendScripted(store: ObjectStore, chat: string, { edits, removed, added, vars }: Scripted): Promise<ApiResult<null>> {
  const at = Date.now();
  const entries: [string, Entry][] = [
    ...edits.map(({ message, text, wrote }): [string, Entry] => {
      const current = shown(message);
      return [crypto.randomUUID(), { type: 'version', message: message.id, replaces: current.id, edit: true, at, text, receipt: current.receipt, seed: current.seed, staged: true, ...(wrote.length > 0 && { before: wrote }), ...(current.greeting !== undefined && { greeting: current.greeting }) }];
    }),
    ...removed.map((message): [string, Entry] => [crypto.randomUUID(), { type: 'delete', message, at }]),
    ...added.flatMap(({ follows, ahead, messages }): [string, Entry][] => {
      const ids = messages.map(() => crypto.randomUUID());
      return [
        ...messages.map(({ role, text }, index): [string, Entry] => [ids[index]!, { type: 'message', role, at, text, receipt: null, follows: index === 0 ? follows : ids[index - 1]!, staged: true }]),
        ...(ahead && ids.length ? [[crypto.randomUUID(), { type: 'follow', message: ahead.id, follows: ids.at(-1)!, at }] satisfies [string, Entry]] : []),
      ];
    }),
    ...(vars && vars.set.length > 0 ? [[crypto.randomUUID(), { type: 'vars', version: vars.version, set: vars.set, at, ...(vars.stays && { stays: true }) }] satisfies [string, Entry]] : []),
  ];
  if (entries.length === 0) return Promise.resolve({ ok: true, data: null });
  return store.batch(entries.map(([id, value]) => ({ type: 'create', kind: 'entry', id, parent: chat, value })));
}

// A call no reply holds (a script's, retrieval's): on the last message shown, so usage and cost count it.
export async function keepCall({ store, read, costs }: Pick<Session, 'store' | 'read' | 'costs'>, chat: string, receipt: Receipt) {
  const last = read.chat(chat).snapshot()?.messages.at(-1);
  if (!last) return;
  const at = Date.now();
  const saved = await append(store, chat, { type: 'call', version: shown(last).id, receipt, at }, undefined, [receiptRow(receipt, at, chatPlace(store, chat))]);
  if (saved.ok) costs.settle(chat, receipt);
}

// A value the user typed in 점검 › 변수, on the version whose state 점검 showed: the last message's shown one. Its
// limits are those 점검 shows a variable whole within (engine/render VARIABLE_LIMITS): past them it is refused, never cut.
export async function setVariableByHand(store: ObjectStore, chat: string, version: string, name: string, value: string) {
  if (name.length > VARIABLE_LIMITS.name || value.length > VARIABLE_LIMITS.value) return { ok: false, error: 'too-long' } as const;
  return append(store, chat, { type: 'vars', version, set: [[name, value]], at: Date.now(), byHand: true });
}

export const appendCost = (store: ObjectStore, chat: string, { id, replyId }: Receipt, cost: Cost | null) => append(store, chat, { type: 'cost', replyId: replyId!, cost, at: Date.now() }, undefined, [costRow(id, cost)]);

// An edit is a new version in the place of the one shown, keeping its receipt. translation: the
// edited translation of a version that has one, which keeps the receipt of the call that made it; a blank one leaves
// the new version without a translation.
// id: the new version's, when the caller must know it before the save lands.
export function editMessage(store: ObjectStore, chat: string, message: Message, text: string, translation: string | null, id?: string) {
  const current = shown(message);
  const at = Date.now();
  const outdated = translation === current.translation?.text && (text !== current.text || translationOutdated(current));
  const kept = translation?.trim() && current.translation && { translation: { ...current.translation, text: translation, at: outdated ? current.translation.at : at } };
  return append(store, chat, { type: 'version', message: message.id, replaces: current.id, edit: true, at, text, receipt: current.receipt, seed: current.seed, ...(current.greeting !== undefined && { greeting: current.greeting }), ...kept }, id);
}

// The post agents' text in the place of the version shown (design §6.16), as an onOutput edit is, keeping the text it
// takes the place of as raw and the agents' calls on its receipt, in place of the post calls of an earlier polish
// (다시 다듬기). A reply always has a receipt.
export function appendPolished(store: ObjectStore, chat: string, message: Message, text: string, runs: AgentRun[]) {
  const current = shown(message);
  const receipt = { ...current.receipt!, agents: [...(current.receipt!.agents ?? []).filter(({ stage }) => stage === 'pre'), ...runs] };
  return append(store, chat, { type: 'version', message: message.id, replaces: current.id, edit: true, at: Date.now(), text, receipt, seed: current.seed, raw: current.raw ?? current.text });
}

// 원문으로 되돌리기: the reply as written before its post agents, in the place of the version shown, which keeps raw.
export function restoreRaw(store: ObjectStore, chat: string, message: Message) {
  const current = shown(message);
  return append(store, chat, { type: 'version', message: message.id, replaces: current.id, edit: true, at: Date.now(), text: current.raw!, receipt: current.receipt, seed: current.seed });
}

// An agent's memory as the user sets it at a version (Entry agentMemory).
export const setAgentMemory = (store: ObjectStore, chat: string, version: string, agent: string, memory: string) =>
  append(store, chat, { type: 'agentMemory', version, agent, memory, at: Date.now() });

// id: the call's, so a call another device saved too is known as saved (runtime/streams).
export const appendTranslation = (store: ObjectStore, chat: string, version: string, translation: Translation, id: string) =>
  append(store, chat, { type: 'translation', version, ...translation }, id, translationRows(store, chat, translation));

// A conflict over an entry already there is the same call saved by another device that read it too. Each device
// stamps its own copy, so the store's check for a create that already landed misses it.
export const savedElsewhere = (store: ObjectStore, chat: string, id: string, failure: ApiFailure) =>
  failure.error === 'conflict' && store.children('entry', chat).some((entry) => entry.id === id);

// The user's own acts go through runtime/message-acts, which tells the chat's tools once they are saved; editMessage
// and branchChat above are its writes too.
export const selectVersion = (store: ObjectStore, chat: string, message: string, version: string) => append(store, chat, { type: 'select', message, version, at: Date.now() });

export const removeMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'delete', message, at: Date.now() });

export const restoreMessage = (store: ObjectStore, chat: string, message: string) => append(store, chat, { type: 'restore', message, at: Date.now() });

// A run of messages deleted or restored as one act, in one batch, so a 되돌리기 brings back all of them or none.
const markAll = (store: ObjectStore, chat: string, messages: string[], type: 'delete' | 'restore') => {
  const at = Date.now();
  return store.batch(messages.map((message) => entryRow(chat, { type, message, at })));
};

export const removeMessages = (store: ObjectStore, chat: string, messages: string[]) => markAll(store, chat, messages, 'delete');

export const restoreMessages = (store: ObjectStore, chat: string, messages: string[]) => markAll(store, chat, messages, 'restore');
