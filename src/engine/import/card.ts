import { add, cardSource, convert, convertModule, counted, extensionOf, lorebookSource, record, text, type Converted, type ConvertedModule, type Json, type Tally } from './convert';
import { readLorebook } from './lorebook';
import { METADATA_BYTES } from './inflate';
import { hazelleSource, printOf, readHazelle, readModule, type ConvertedBundle } from './hazelle';
import { UNSUPPORTED_KINDS, type Bot, type Card, type ImportFailure, type ImportedModule, type ImportReport, type ImportResult, type Imported, type LoreEntry } from './types';
import { base64, readPng } from './png';
import { readPersona } from './persona';
import { readRisum, readRisumModule, writeRisum } from './risum';
import type { FileSource } from './source';
import { writeToggles } from './toggles';
import { openZip, type Zip } from './zip';
import { isRecord } from '../../connectors/values';

const utf8 = new TextDecoder();
const fail = (kind: ImportFailure['kind'], detail?: string): { ok: false; failure: ImportFailure } => ({ ok: false, failure: detail ? { kind, detail } : { kind } });

export const blankCard = (name: string): Card => ({
  name, nickname: null, description: '', personality: '', scenario: '', greetings: [], exampleDialogue: '', systemPrompt: '', postHistoryInstructions: '',
  creatorNotes: '', creator: '', version: '', tags: [], variables: [], toggles: [], utility: false, bias: [], regex: [], triggers: [],
  loreSettings: { scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null },
});

// Risu exports a module as a card named <name>.module.charx (modules.ts exportModule); a browser that already holds
// that name adds a count, as in "name.module(2).charx".
const MODULE_CHARX = /\.module\s*(?:\(\d+\)\s*)?\.charx$/i;

// Dispatch goes by extension and the way in, as in Risu, and a JSON by its shape. A charx is never sniffed: Risu's module
// export leaves no mark in the card. asModule: the file came in on the module list, where Risu's importModule reads any
// .charx as a module.
export function importCard(fileName: string, bytes: Uint8Array<ArrayBuffer>, asModule = false): ImportResult {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  try {
    switch (extension) {
      case 'png':
        return fromPng(bytes);
      case 'charx':
        return asModule || MODULE_CHARX.test(fileName) ? fromModuleCharx(bytes) : fromCharx(bytes);
      case 'jpg':
      case 'jpeg':
        return fromCharx(bytes);
      case 'json':
      case 'lorebook':
        return fromJson(bytes);
      default:
        return fail('unknown-format');
    }
  } catch (error) {
    return fail('unreadable', error instanceof Error ? error.message : String(error));
  }
}

function fromPng(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const png = readPng(bytes);
  if (!png) return fail('unreadable', 'not a PNG');
  if (!png.card) return png.persona === null ? fail('unreadable', 'the PNG holds no card') : readPersona(png.persona, png.image);
  if (png.card.startsWith('rcc||')) return fail('encrypted');
  const tally: Tally = new Map();
  const converted = convert(JSON.parse(utf8.decode(base64(png.card))), null, tally);
  return converted ? done('png', converted, { bytes: png.image, type: 'image/png' }, { chunks: png.assets }, tally, NOT_OWN) : fail('unreadable', 'not a character card');
}

function readCharx(bytes: Uint8Array<ArrayBuffer>, tally: Tally): { zip: Zip; raw: unknown; converted: Converted } | ImportResult {
  const zip = openZip(bytes);
  const card = zip?.read('card.json', METADATA_BYTES);
  if (!zip || !card) return fail('unreadable', 'no card.json');
  const moduleBytes = zip.read('module.risum', METADATA_BYTES);
  const module = moduleBytes ? readRisumModule(moduleBytes) : null;
  if (moduleBytes && !module) add(tally, 'module');
  const raw: unknown = JSON.parse(utf8.decode(card));
  const converted = convert(raw, module, tally);
  return converted ? { zip, raw, converted } : fail('unreadable', 'not a character card');
}

function fromCharx(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const tally: Tally = new Map();
  const charx = readCharx(bytes, tally);
  if ('ok' in charx) return charx;
  const { zip, raw, converted } = charx;
  const extensions = record(record(record(raw).data).extensions);
  const { read, own, bundled } = readHazelle(extensions.hazelle, text(record(extensions.risuai).toggles), converted, tally);
  return done('charx', read, avatar(read.icon, zip.prefix, zip, tally), { zip }, tally, { own, bundled });
}

// Read as Risu reads it back: as a character, then convertCharacterToModule, where the creator notes are the module's
// description and moduleNamespace its namespace. The card's icon is the carrier's picture, not the module's.
function fromModuleCharx(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const tally: Tally = new Map();
  const charx = readCharx(bytes, tally);
  if ('ok' in charx) return charx;
  const { card, lore, loreFolders, assets } = charx.converted;
  const { regex, triggers, background, toggles } = card;
  const pack = { regex, triggers, ...(background === undefined ? {} : { background }), toggles };
  const namespace = text(record(record(record(record(charx.raw).data).extensions).risuai).moduleNamespace).trim() || null;
  return { ok: true, module: { name: card.name, description: card.creatorNotes, namespace, risu: null, pack, lore: [...lore, ...characterLore(card)], loreFolders, assets: located(assets, resolver({ zip: charx.zip }, tally)), unsupported: counted(UNSUPPORTED_KINDS, tally) } };
}

// Invert convertModuleToCharacter's @@indicator fields as Risu's convertCharacterToModule does
// (interchangeability.ts:74-117): these names, order 0, no keys. Greetings are non-constant and never fire;
// module lore content is not migrated.
function characterLore({ description, greetings, postHistoryInstructions }: Card): LoreEntry[] {
  const entry = (name: string, content: string, constant: boolean): LoreEntry => ({
    name, keys: [], secondaryKeys: [], content, enabled: true, constant, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 0, priority: null, position: null, folder: null,
  });
  const [first = '', ...alternate] = greetings;
  const messages = [`<FM>\n${first}\n</FM>`, ...alternate.map((greeting) => `<FM_alt>\n${greeting}\n</FM_alt>`)].join('\n');
  return [
    ...(description ? [entry('From Character Description', `@@indicator character_desc\n\n${description}`, true)] : []),
    ...(greetings.length ? [entry('From First Messages', `@@indicator character_first_message\n\n${messages}`, false)] : []),
    ...(postHistoryInstructions ? [entry('From Global Note Replacement', `@@indicator replace_global_note\n\n${postHistoryInstructions}`, true)] : []),
  ];
}

// A .risum is read apart from importCard, from slices of the file: a module of pictures runs to gigabytes.
export async function importRisum(source: FileSource): Promise<{ ok: true; module: ImportedModule } | { ok: false; failure: ImportFailure }> {
  try {
    const read = await readRisum(source);
    if (!read) return fail('unreadable', 'not a module');
    const tally: Tally = new Map();
    const { assets: names, ...module } = readModule(read.module, tally);
    add(tally, 'missing-asset', Math.max(0, names.length - read.assets.length));
    const assets = read.assets.slice(0, names.length).map((block, index) => ({ name: names[index]!, read: block }));
    return { ok: true, module: { ...module, assets, unsupported: counted(UNSUPPORTED_KINDS, tally) } };
  } catch (error) {
    return fail('unreadable', error instanceof Error ? error.message : String(error));
  }
}

function fromJson(bytes: Uint8Array<ArrayBuffer>): ImportResult {
  const tally: Tally = new Map();
  const raw: unknown = JSON.parse(utf8.decode(bytes));
  const read = isRecord(raw) ? moduleOf(raw, tally) : null;
  // A module's JSON names its pictures without holding them.
  if (read) {
    const { assets, ...module } = read;
    add(tally, 'missing-asset', assets.length);
    return { ok: true, module: { ...module, assets: [], unsupported: counted(UNSUPPORTED_KINDS, tally) } };
  }
  const converted = convert(raw, null, tally);
  return converted ? done('json', converted, avatar(converted.icon, null, null, tally), {}, tally, NOT_OWN) : fail('unreadable', 'not a character card');
}

// Risu's module list also takes a lorebook or regex export, as a module made of it (modules.ts importModule); here every
// way in does, since the shape says what the file is.
function moduleOf(raw: Json, tally: Tally): ConvertedModule | null {
  if (raw.type === 'risuModule') return readModule(raw, tally);
  const book = readLorebook(raw, tally);
  if (book) return { ...convertModule({ name: book.name, description: book.description }, tally), lore: book.lore, loreFolders: book.loreFolders };
  if (raw.type === 'regex' && Array.isArray(raw.data)) return readModule({ name: raw.name, description: raw.description, regex: raw.data }, tally);
  return null;
}

type Holders = { zip?: Zip; chunks?: Map<string, string> };
type Owned = { own: Imported['own']; bundled: ConvertedBundle[] };
const NOT_OWN: Owned = { own: null, bundled: [] };

function done(format: ImportReport['format'], converted: Converted, avatar: Imported['avatar'], holders: Holders, tally: Tally, { own, bundled }: Owned): ImportResult {
  const resolve = resolver(holders, tally);
  const modules = bundled.map((module) => ({ ...module, assets: located(module.assets, resolve) }));
  return { ok: true, card: { ...assemble(format, converted, resolve, tally), avatar, own, bundled: modules } };
}

// Where an asset's bytes are read from; null for a uri the source does not hold, which the resolver counts.
export type Resolve = (uri: string) => Imported['assets'][number]['read'] | null;

const resolver = (holders: Holders, tally: Tally): Resolve => (uri) => {
  const read = reader(uri, holders);
  if (!read) add(tally, 'missing-asset');
  return read && (async () => read());
};

const located = (assets: Converted['assets'], resolve: Resolve): Imported['assets'] =>
  assets.flatMap(({ name, uri }) => {
    const read = resolve(uri);
    return read ? [{ name, read }] : [];
  });

// The report is counted after the assets are resolved, so the resolver's counts are in it.
export function assemble(format: ImportReport['format'], converted: Converted, resolve: Resolve, tally: Tally): Omit<Imported, 'avatar' | 'own' | 'bundled'> {
  const { card, lore, loreFolders, spec } = converted;
  const assets = located(converted.assets, resolve);
  return { card, lore, loreFolders, assets, report: { format, spec, unsupported: counted(UNSUPPORTED_KINDS, tally) } };
}

// An asset's bytes as Risu finds them: __asset:N a PNG chunk, embeded:// (Risu's spelling) a file in the charx,
// data: inline. null for a uri none of them is, such as a web address.
function reader(uri: string, { zip, chunks }: Holders): (() => Uint8Array<ArrayBuffer> | null) | null {
  if (uri.startsWith('__asset:') && chunks) {
    const chunk = chunks.get(uri.slice('__asset:'.length));
    return () => (chunk === undefined ? null : decode(chunk));
  }
  if (uri.startsWith('embeded://') && zip) return () => zip.read(uri.slice('embeded://'.length));
  if (uri.startsWith('data:')) return () => dataUri(uri);
  return null;
}

function decode(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return base64(text);
  } catch {
    return null;
  }
}

// CCv3's icon resolution: no icon or ccdefault: is the file's own image (the JPEG in front of a charx's zip),
// embeded:// (the spec's spelling) a file in the charx, data: an inline image, as Risu's JSON export writes it.
// An icon that cannot be read is counted as a missing asset, one that is not a picture as an unsupported file.
function avatar(uri: string | null, own: Uint8Array<ArrayBuffer> | null, zip: Zip | null, tally: Tally): Imported['avatar'] {
  if (uri === null || uri === 'ccdefault:') return own?.length ? image(own, tally) : null;
  const bytes = uri.startsWith('embeded://') ? zip?.read(uri.slice('embeded://'.length)) : uri.startsWith('data:') ? dataUri(uri) : null;
  if (!bytes) {
    add(tally, 'missing-asset');
    return null;
  }
  return image(bytes, tally);
}

function dataUri(uri: string): Uint8Array<ArrayBuffer> | null {
  const comma = uri.indexOf(',');
  if (comma === -1 || !uri.slice(0, comma).endsWith(';base64')) return null;
  return decode(uri.slice(comma + 1));
}

function image(bytes: Uint8Array<ArrayBuffer>, tally: Tally): Imported['avatar'] {
  const type = imageType(bytes);
  if (!type) {
    add(tally, 'unsupported-file');
    return null;
  }
  return { bytes, type };
}

export function imageType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(4, 12) === 'ftypavif' || ascii(4, 12) === 'ftypavis') return 'image/avif';
  return null;
}

// A picture's type and size in pixels, read from its header; null when imageType knows no such picture or the header
// holds no size.
export function imageSize(bytes: Uint8Array): { type: string; width: number; height: number } | null {
  const type = imageType(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  const read = (): [number, number] | null => {
    switch (type) {
      case 'image/png': return [view.getUint32(16), view.getUint32(20)];
      case 'image/gif': return [view.getUint16(6, true), view.getUint16(8, true)];
      case 'image/webp': {
        const chunk = ascii(12, 16);
        if (chunk === 'VP8 ') return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
        if (chunk === 'VP8L') { const bits = view.getUint32(21, true); return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1]; }
        if (chunk === 'VP8X') return [(view.getUint32(24, true) & 0xffffff) + 1, (view.getUint32(27, true) & 0xffffff) + 1];
        return null;
      }
      case 'image/avif': {
        const at = ascii(0, Math.min(bytes.length, 4096)).indexOf('ispe');
        return at === -1 ? null : [view.getUint32(at + 8), view.getUint32(at + 12)];
      }
      case 'image/jpeg': {
        for (let at = 2; at + 9 <= bytes.length;) {
          if (bytes[at] !== 0xff) return null;
          const marker = bytes[at + 1]!;
          // The start-of-frame markers, which hold the size; C4, C8 and CC share the range but are tables.
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return [view.getUint16(at + 7), view.getUint16(at + 5)];
          at += marker === 0xff ? 1 : 2 + view.getUint16(at + 2);
        }
        return null;
      }
      default: return null;
    }
  };
  try {
    const size = read();
    return type && size && size[0] > 0 && size[1] > 0 ? { type, width: size[0], height: size[1] } : null;
  } catch (error) {
    // A header cut short reads past the bytes.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

// MP4's major brands for video. An audio-only file names M4A or M4B and stays out, as audio is not kept (user,
// 2026-10-15: video only).
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash', 'mmp4']);

// What a bot's asset may be: a picture, or a video. Avatars, persona pictures and inlays stay pictures (imageType).
export function assetType(bytes: Uint8Array): string | null {
  const picture = imageType(bytes);
  if (picture) return picture;
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (ascii(4, 8) === 'ftyp' && MP4_BRANDS.has(ascii(8, 12))) return 'video/mp4';
  // EBML's header, whose DocType tells WebM from Matroska.
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && ascii(4, 64).includes('webm')) return 'video/webm';
  return null;
}

const utf8Out = new TextEncoder();

// Inverse of fromCharx: avatar first, then character assets, then bundled modules. Use positional picture paths,
// not untrusted names, and fingerprint the re-read output rather than the input.
export function writeCharx(bot: Bot): { files: { path: string; bytes: Uint8Array<ArrayBuffer> }[]; pictures: string[] } {
  const source = hazelleSource(bot);
  const icon = bot.avatar === null ? [] : [{ type: 'icon', name: 'main', ext: extensionOf(bot.avatar), uri: `embeded://assets/icon/image/main.${extensionOf(bot.avatar)}` }];
  const assets = [...icon, ...source.assets.map(({ name, type }, place) => ({ type: 'x-risu-asset', name, ext: extensionOf(type), uri: `embeded://assets/other/image/${place}.${extensionOf(type)}` }))];
  const module = writeRisum({ name: bot.card.name, description: '', regex: source.regex, trigger: source.triggers, lorebook: lorebookSource(source.lore, source.loreFolders) });
  const plain = utf8Out.encode(JSON.stringify(cardSource(bot.card, assets, {}, source.lua)));
  const read = convert(JSON.parse(utf8.decode(plain)), readRisumModule(module)!, new Map())!;
  const card = cardSource(bot.card, assets, { hazelle: { ...source.extension, print: printOf(read, writeToggles(bot.card.toggles)) } }, source.lua);
  return {
    files: [{ path: 'card.json', bytes: utf8Out.encode(JSON.stringify(card)) }, { path: 'module.risum', bytes: module }],
    pictures: assets.map(({ uri }) => uri.slice('embeded://'.length)),
  };
}
