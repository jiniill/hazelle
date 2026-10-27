import { isRecord, list } from '../../connectors/values';
import { SIGNATURE } from '../assets';
import { imageType } from './card';
import { add, counted, record, text, type Json, type Tally } from './convert';
import { readModule } from './hazelle';
import { expansionLimit, gunzip, TooLarge } from './inflate';
import { readMsgpack } from './msgpack';
import { risuPersonaFields } from './persona';
import type { FileSource } from './source';
import { convertPreset } from './preset';
import { chatInfo, picture, risuCharacter, type Entry, type Read } from './risu-character';
import {
  MOVE_UNSUPPORTED_KINDS,
  UNSUPPORTED_KINDS,
  type BackupFailure,
  type BackupCatalog,
  type BackupResult,
  type Imported,
  type ImportedModule,
  type MoveUnsupportedKind,
  type RisuBackup,
  type RisuPersona,
  type RisuPreset,
} from './types';

type Span = { source: FileSource; offset: number; length: number };
type Cold = (key: string) => Promise<unknown>;

// The three forms a backup's database is written in (spec §2): until Risu 2026-10-14, 00 'RISUSAVE' 00 08 then gzip
// over msgpackr; since then, 'RISUSAVE' 00 then blocks of JSON; and 00 'RISUSAVE' 00 07 then msgpackr unzipped, which
// Risu reads and PocketRisu writes.
const LEGACY_HEADER = [0, ...Array.from('RISUSAVE', (char) => char.charCodeAt(0)), 0, 8];
const PLAIN_HEADER = [...LEGACY_HEADER.slice(0, -1), 7];
const BLOCK_HEADER = [...Array.from('RISUSAVE', (char) => char.charCodeAt(0)), 0];
// Block types: 1 root (every key but the three below), 2 a character, 4 the presets, 5 the modules. 0, 9–12 (config,
// plugins, loadouts, plugin storage, kv) are not read; 6 (a file on the Risu device) is never in a backup.
const ROOT = 1;
const CHARACTER = 2;
const PRESETS = 4;
const MODULES = 5;
// coldstorageData.ts:4. The private-use marks are part of the pointer; the bare word is not one.
const COLD = 'COLDSTORAGE';
const READ_AHEAD = 4 * 1024 * 1024;
const COLD_READS = 8;
// storage/database.svelte.ts:73-77 (risu-compat-spec §a). The depth is the one engine/lorebook/activate fixes.
const RISU_LORE_DEPTH = 5;
const RISU_LORE_BUDGET = 800;
const TOGGLE = 'toggle_';
// A preset slot's keys and endpoints, never read (design F7).
const SECRETS = new Set(['openAIKey', 'proxyKey', 'forceReplaceUrl', 'forceReplaceUrl2', 'textgenWebUIStreamURL', 'textgenWebUIBlockingURL']);

const utf8 = new TextDecoder();
const fail = (kind: BackupFailure['kind'], detail?: string): BackupResult => ({ ok: false, failure: detail ? { kind, detail } : { kind } });

// Merge archives with the first unencrypted database's file taking precedence; encrypted full backups can still supply
// plain pictures alongside a partial backup's text. Read only database/cold metadata now, histories on selection, pictures on demand.
export async function readBackup(sources: FileSource[]): Promise<BackupResult> {
  try {
    const indexed = await Promise.all(sources.map((source) => index(readAhead(source), source)));
    const main = indexed.findIndex((files) => files.has('database.risudat') && !files.has('encryption.risudat'));
    if (main === -1) return fail(indexed.some((files) => files.has('encryption.risudat')) ? 'encrypted' : 'no-database');
    const files = new Map(indexed.flatMap((entries, at) => (at === main ? [] : [...entries])));
    for (const [name, span] of indexed[main]!) files.set(name, span);
    const database = files.get('database.risudat')!;
    const db = decode(await database.source.read(database.offset, database.length));
    if (!isRecord(db)) return fail('unreadable', 'not a Risu database');
    return { ok: true, backup: await fromDatabase(db, files) };
  } catch (error) {
    if (error instanceof TooLarge) return fail('expands-too-far');
    return fail('unreadable', error instanceof Error ? error.message : String(error));
  }
}

function readAhead(source: FileSource): FileSource {
  let start = 0;
  let bytes = new Uint8Array(0);
  return {
    size: source.size,
    async read(offset, length) {
      if (length > READ_AHEAD) return source.read(offset, length);
      if (offset < start || offset + length > start + bytes.length) {
        bytes = await source.read(offset, Math.min(READ_AHEAD, source.size - offset));
        start = offset;
      }
      return bytes.subarray(offset - start, offset - start + length);
    },
  };
}

// Bare little-endian records: u32 name length, name, u32 data length, data (spec §1).
// Spans use raw for concurrent entry reads; the read-ahead window is sequential only.
async function index(source: FileSource, raw: FileSource): Promise<Map<string, Span>> {
  const files = new Map<string, Span>();
  const take = (offset: number, length: number) => {
    if (offset + length > source.size) throw new Error('the file ends early');
    return source.read(offset, length);
  };
  for (let at = 0; at < source.size; ) {
    const nameLength = u32(await take(at, 4), 0);
    const head = await take(at + 4, nameLength + 4);
    const length = u32(head, nameLength);
    files.set(utf8.decode(head.subarray(0, nameLength)), { source: raw, offset: at + 8 + nameLength, length });
    at += 8 + nameLength + length;
    if (at > source.size) throw new Error('the file ends early');
  }
  return files;
}

// inlayExport writes backup-layout inlay_<id> JSON for pictures/Gemini signatures. Its first entry, inlay_skipped.json,
// identifies this export and lists omitted audio/video; other files return null.
export async function readInlays(source: FileSource): Promise<Inlays | null> {
  const ahead = readAhead(source);
  if (source.size < 4) return null;
  const nameLength = u32(await ahead.read(0, 4), 0);
  if (4 + nameLength > source.size || utf8.decode(await ahead.read(4, nameLength)) !== INLAY_SKIPPED) return null;
  const files = await index(ahead, source);
  return inlaysOf(new Map([...files].flatMap(([name, span]) => (name.startsWith(INLAY) && name !== INLAY_SKIPPED ? [[name.slice(INLAY.length), span]] : []))));
}

// The inlays a PocketRisu backup holds beside its database, as inlay/<id>.<ext>; Risu keeps them in the browser, so its
// backup holds none. null: none, or a file that does not read, which reading it as a backup then reports.
export async function backupInlays(source: FileSource): Promise<Inlays | null> {
  let files: Map<string, Span>;
  try {
    files = await index(readAhead(source), source);
  } catch {
    return null;
  }
  const held = new Map<string, Span>();
  for (const [name, span] of files) {
    if (!name.startsWith(HELD_INLAY)) continue;
    const file = name.slice(HELD_INLAY.length);
    const dot = file.lastIndexOf('.');
    held.set(dot === -1 ? file : file.slice(0, dot), span);
  }
  return held.size > 0 ? inlaysOf(held) : null;
}

const inlaysOf = (spans: Map<string, Span>): Inlays => ({
  count: spans.size,
  bytes: [...spans.values()].reduce((sum, span) => sum + span.length, 0),
  assets: (ids) => ids.map((id) => {
    const span = spans.get(id);
    return { name: id, read: span ? () => span.source.read(span.offset, span.length) : () => Promise.resolve(null) };
  }),
});

// count and bytes: the file's entries together. assets: an entry per id, which reads null for one the file lacks.
export type Inlays = { count: number; bytes: number; assets(ids: string[]): Imported['assets'] };

const INLAY = 'inlay_';
const INLAY_SKIPPED = `${INLAY}skipped.json`;
const HELD_INLAY = 'inlay/';

// A picture's type, or SIGNATURE for a Gemini thought signature's item; only an inlay is stored as either.
export function inlayType(bytes: Uint8Array): string | null {
  const type = imageType(bytes);
  if (type || bytes[0] !== 0x7b) return type;
  try {
    const item: unknown = JSON.parse(utf8.decode(bytes));
    return isRecord(item) && item.type === SIGNATURE ? SIGNATURE : null;
  } catch {
    return null;
  }
}

const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);

const startsWith = (bytes: Uint8Array, header: number[]) => header.every((byte, i) => bytes[i] === byte);

function decode(bytes: Uint8Array): unknown {
  if (startsWith(bytes, LEGACY_HEADER)) return readMsgpack(gunzip(bytes.subarray(LEGACY_HEADER.length), expansionLimit(bytes.length)));
  if (startsWith(bytes, PLAIN_HEADER)) return readMsgpack(bytes.subarray(PLAIN_HEADER.length));
  if (startsWith(bytes, BLOCK_HEADER)) return readBlocks(bytes.subarray(BLOCK_HEADER.length));
  throw new Error('not a Risu database');
}

// Each block: type u8, gzip flag u8, name length u8, name, data length u32, data (UTF-8 JSON). Characters come one per
// block, in the file's order, which is Risu's list order. The blocks share one limit, the database's.
function readBlocks(bytes: Uint8Array): unknown {
  const db: Record<string, unknown> = {};
  const characters: unknown[] = [];
  let room = expansionLimit(bytes.length);
  for (let at = 0; at < bytes.length; ) {
    const type = bytes[at]!;
    const zipped = bytes[at + 1] === 1;
    const nameLength = bytes[at + 2]!;
    const length = u32(bytes, at + 3 + nameLength);
    const start = at + 7 + nameLength;
    at = start + length;
    if (at > bytes.length) throw new Error('the database ends early');
    if (type !== ROOT && type !== CHARACTER && type !== PRESETS && type !== MODULES) continue;
    const data = zipped ? gunzip(bytes.subarray(start, at), room) : bytes.subarray(start, at);
    room -= data.length;
    const value: unknown = JSON.parse(utf8.decode(data));
    if (type === CHARACTER) characters.push(value);
    else if (type === PRESETS) db.botPresets = value;
    else if (type === MODULES) db.modules = value;
    else if (isRecord(value)) for (const [key, item] of Object.entries(value)) if (!key.startsWith('__')) db[key] = item;
  }
  return { ...db, characters };
}

// A picture entry is a basename (fromDatabase's entry), so a name with a folder is not one: PocketRisu's inlay/,
// inlay_sidecar/, inlay_meta/ and coldstorage/.
const isPicture = (name: string) => name !== 'database.risudat' && name !== 'encryption.risudat' && !name.startsWith('coldstorage_') && !name.includes('/');

async function fromDatabase(db: Json, files: Map<string, Span>): Promise<RisuBackup> {
  const reader = (span: Span): Read => () => span.source.read(span.offset, span.length);
  // An entry is named by the basename of its asset key (spec §7).
  const entry: Entry = (key) => {
    const span = files.get(key.slice(Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\')) + 1));
    return span ? reader(span) : null;
  };
  let reading = 0;
  const waiting: (() => void)[] = [];
  // Character and chat payloads share the same limit, including chats inside a cold character.
  const cold: Cold = async (key) => {
    // Risu writes coldstorage_, PocketRisu coldstorage/; Risu's own import takes both.
    const span = files.get(`coldstorage_${key}.json`) ?? files.get(`coldstorage/${key}.json`);
    if (!span) return null;
    if (reading === COLD_READS) await new Promise<void>((resolve) => waiting.push(resolve));
    else reading++;
    try {
      const bytes = await reader(span)();
      // A payload that does not parse is as missing as one the backup left out.
      try {
        return JSON.parse(utf8.decode(bytes));
      } catch {
        return null;
      }
    } finally {
      const next = waiting.shift();
      if (next) next();
      else reading--;
    }
  };

  const order = new Map<string, number>();
  const folders = new Map<string, string>();
  for (const item of list(db.characterOrder)) {
    for (const id of typeof item === 'string' ? [item] : list(record(item).data)) {
      if (typeof id !== 'string' || order.has(id)) continue;
      order.set(id, order.size);
      if (isRecord(item)) folders.set(id, text(item.name));
    }
  }

  const raw = list(db.characters);
  const load = async (key: number) => {
    const stub = raw[key] as Json;
    return typeof stub.coldstorage === 'string' ? coldCharacter(stub, stub.coldstorage, cold) : stub;
  };
  const unsupported: Tally<MoveUnsupportedKind> = new Map();
  const loaded = await Promise.all(raw.map(async (stub, key): Promise<BackupCatalog['characters'][number] | null> => {
    if (!isRecord(stub) || text(stub.chaId).startsWith('§')) return null;
    const char = await load(key);
    if (!char) {
      add(unsupported, 'cold-missing');
      return null;
    }
    if (typeof char.trashTime === 'number') return null;
    if (char.type === 'group') {
      add(unsupported, 'group-chat', list(char.chats).filter((chat) => list(record(chat).message).length > 0).length);
      return null;
    }
    // A cold payload may be needed for exact counts/order, but no unselected RisuChat or message text is kept.
    const chats = await Promise.all(list(char.chats).map(async (chat) => chatInfo(await coldChat(record(chat), cold))));
    const character = risuCharacter(char, [], folders.get(text(char.chaId)) ?? null, entry);
    return {
      key, id: character.id, name: character.card.name, assetCount: character.assets.length,
      chatCount: chats.filter((chat) => chat !== null).length,
      inlayCount: chats.reduce((sum, chat) => sum + (chat?.inlays ?? 0), 0),
      lastTalk: chats.reduce((latest, chat) => Math.max(latest, chat?.lastTalk ?? 0), 0),
    };
  }));
  const characters = loaded.filter((char) => char !== null);
  characters.sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size));

  // Risu builds one persona from the live values when the list is absent (setDatabase).
  const selected = typeof db.selectedPersona === 'number' ? db.selectedPersona : 0;
  const kept = (Array.isArray(db.personas) ? db.personas : [{}]).flatMap((raw, index) => (isRecord(raw) ? [{ raw, selected: index === selected }] : []));
  const personas = kept.map(({ raw, selected }): RisuPersona => {
    // The selected persona's live copy is the database's top level (spec §5).
    const persona = selected ? { ...raw, name: db.username, icon: db.userIcon, personaPrompt: db.personaPrompt } : raw;
    const icon = text(persona.icon) && entry(text(persona.icon));
    const module = isRecord(persona.embeddedModule) ? risuModule(persona.embeddedModule, entry) : null;
    return { id: text(persona.id) || null, ...risuPersonaFields(persona), picture: icon ? () => picture(icon) : () => Promise.resolve(null), module };
  });

  const presets = list(db.botPresets).flatMap((raw, index): RisuPreset[] =>
    isRecord(raw) ? [{ name: text(raw.name), result: convertPreset(index === db.botPresetsId ? live(raw, db) : raw) }] : [],
  );

  const modules = list(db.modules).filter(isRecord).map((raw) => risuModule(raw, entry));
  const alwaysModules = list(db.enabledModules).filter((id) => typeof id === 'string');
  // Risu's default, which most never changed, is not the user's choice: carried, it would cut every heavy lorebook.
  const loreBudget = typeof db.loreBookToken === 'number' && Number.isInteger(db.loreBookToken) && db.loreBookToken > 0 && db.loreBookToken !== RISU_LORE_BUDGET ? db.loreBookToken : null;
  if (typeof db.loreBookDepth === 'number' && db.loreBookDepth !== RISU_LORE_DEPTH) add(unsupported, 'lore-depth');
  const toggles = Object.fromEntries(Object.entries(record(db.globalChatVariables)).flatMap(([key, value]) => (key.startsWith(TOGGLE) && typeof value === 'string' ? [[key.slice(TOGGLE.length), value]] : [])));

  const pictures = [...files].filter(([name]) => isPicture(name));
  return {
    catalog: {
      pictures: pictures.length, pictureBytes: pictures.reduce((sum, [, span]) => sum + span.length, 0), characters,
      personas: personas.map(({ name, alias }, key) => ({ key, name, alias, selected: kept[key]!.selected })),
      presets: presets.map(({ name, result }, key) => ({ key, name, failure: result.ok ? null : result.failure.kind })),
      modules: modules.map(({ name, risu, assets }, key) => ({ key, name, risu, assetCount: assets.length })),
      alwaysModules, loreBudget, toggles, unsupported: counted(MOVE_UNSUPPORTED_KINDS, unsupported),
    },
    async character(key) {
      const char = (await load(key))!;
      const chats = await Promise.all(list(char.chats).map((chat) => coldChat(record(chat), cold)));
      return risuCharacter(char, chats, folders.get(text(char.chaId)) ?? null, entry);
    },
    persona: async (key) => personas[key]!,
    preset: async (key) => presets[key]!,
    module: async (key) => modules[key]!,
  };
}

// A module's pictures are in the backup's asset storage, each under the key its entry of module.assets holds. One the
// backup lacks is counted as an asset the module names without holding, as for a module file.
function risuModule(raw: Json, entry: Entry): ImportedModule {
  const tally: Tally = new Map();
  const { assets: names, ...module } = readModule(raw, tally);
  const assets = list(raw.assets).flatMap((asset, index) => {
    const key = Array.isArray(asset) ? text(asset[1]) : '';
    // Any key other than a Risu asset key points outside the backup.
    const read = key.startsWith('assets/') ? entry(key) : null;
    if (!read) add(tally, 'missing-asset');
    return read ? [{ name: names[index]!, read }] : [];
  });
  return { ...module, assets, unsupported: counted(UNSUPPORTED_KINDS, tally) };
}

// Classed by the payload's type: a stub says 'character' even for a group.
async function coldCharacter(stub: Json, key: string, cold: Cold): Promise<Json | null> {
  const payload = await cold(key);
  const char = isRecord(payload) ? payload.character : null;
  return isRecord(char) && char.chaId === stub.chaId ? char : null;
}

// A chat whose messages Risu moved out leaves one message holding the pointer; null when the backup lacks them.
// lastDate stays the chat's own, where Risu's rehydration sets it to now.
async function coldChat(chat: Json, cold: Cold): Promise<Json | null> {
  const pointer = text(record(list(chat.message)[0]).data);
  if (!pointer.startsWith(COLD)) return chat;
  const payload = await cold(pointer.slice(COLD.length));
  // An older payload is the message list alone.
  if (Array.isArray(payload)) return { ...chat, message: payload };
  if (!isRecord(payload) || !Array.isArray(payload.message)) return null;
  const { message, hypaV2Data, hypaV3Data, scriptstate, localLore } = payload;
  return { ...chat, message, hypaV2Data, hypaV3Data, scriptstate, localLore };
}

// The active slot's values live at the database's top level until Risu saves the preset (saveCurrentPreset): each
// key the slot holds is taken from there, regex from presetRegex. Its name and picture stay the slot's.
function live(slot: Json, db: Json): Json {
  return Object.fromEntries(
    Object.entries(slot).flatMap(([key, value]) => {
      if (SECRETS.has(key)) return [];
      if (key === 'name' || key === 'image') return [[key, value]];
      return [[key, db[key === 'regex' ? 'presetRegex' : key]]];
    }),
  );
}
