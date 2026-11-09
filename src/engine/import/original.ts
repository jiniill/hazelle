import { fromBase64, toBase64 } from '../../base64';
import { concat } from './inflate';
import { readPng, withText } from './png';
import { readRisum, risumBlock, risumHead, RISUM_END } from './risum';
import type { FileSource } from './source';
import { openZip, zipWriter } from './zip';

// A piece of an imported file, kept so a later parser can read the file again (docs/roadmap/import-originals.md). A
// piece that came in as an asset or the avatar is byte for byte that file, so storing it again uploads nothing.
export type Part = { path: string; read: () => Promise<Uint8Array<ArrayBuffer> | null> };

const ZIP = 'zip/';
const ZIP_PREFIX = 'zip-prefix';
const PNG_IMAGE = 'png-image';
const PNG_CARD = 'png-card';
const PNG_ASSET = 'png-asset/';
const RISUM_MODULE = 'risum-module';
const RISUM_BLOCK = 'risum-block/';
const WHOLE = 'file';

const utf8 = new TextEncoder();
const text = new TextDecoder();
const at = (bytes: Uint8Array<ArrayBuffer> | null) => async () => bytes;

// Split by what the bytes are, not by the name: a card PNG, a zip (a charx, or a JPEG with one appended), else whole.
export function originalParts(bytes: Uint8Array<ArrayBuffer>): Part[] {
  const png = readPng(bytes);
  const card = png?.card;
  if (png && card) {
    const assets = [...png.assets].map(([key, chunk]): Part => ({ path: PNG_ASSET + key, read: async () => decoded(chunk) }));
    return [{ path: PNG_IMAGE, read: at(png.image) }, { path: PNG_CARD, read: async () => utf8.encode(card) }, ...assets];
  }
  const zip = zipOf(bytes);
  if (zip) return [...(zip.prefix.length ? [{ path: ZIP_PREFIX, read: at(zip.prefix) }] : []), ...zip.names.filter((name) => !name.endsWith('/')).map((name) => ({ path: ZIP + name, read: async () => zip.read(name) }))];
  return [{ path: WHOLE, read: at(bytes) }];
}

export async function risumParts(source: FileSource): Promise<Part[]> {
  const risum = await readRisum(source);
  if (!risum) return [];
  return [{ path: RISUM_MODULE, read: at(utf8.encode(JSON.stringify(risum.module))) }, ...risum.assets.map((read, index) => ({ path: RISUM_BLOCK + index, read }))];
}

// A file the parser reads as it read the one split: entries and chunks in another order, a module re-serialized.
export async function joinOriginal(parts: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): Promise<Uint8Array<ArrayBuffer>> {
  const whole = parts.get(WHOLE);
  if (whole) return whole;
  const card = parts.get(PNG_CARD);
  // Without its image, which the server may have refused to keep, it is no PNG and reads as nothing.
  const image = parts.get(PNG_IMAGE);
  if (card && image) {
    let png = withText(image, 'ccv3', text.decode(card));
    for (const [path, bytes] of under(parts, PNG_ASSET)) png = withText(png, `chara-ext-asset_:${path}`, toBase64(bytes));
    return png;
  }
  const module = parts.get(RISUM_MODULE);
  if (module) {
    const blocks = [...under(parts, RISUM_BLOCK)].sort(([a], [b]) => Number(a) - Number(b)).map(([, bytes]) => risumBlock(bytes));
    return concat([risumHead(JSON.parse(text.decode(module)) as Record<string, unknown>), ...blocks, RISUM_END]);
  }
  const written: Uint8Array<ArrayBuffer>[] = [parts.get(ZIP_PREFIX) ?? new Uint8Array()];
  const zip = zipWriter(async (bytes) => void written.push(bytes));
  for (const [path, bytes] of under(parts, ZIP)) await zip.add(path, bytes);
  await zip.end();
  return concat(written);
}

// What a parser reads of a file to learn what it holds; png-image is the PNG's own chunks. Every other piece is a
// picture or a sound, read only when it is stored (engine/import/card resolver), so a read again for what a newer
// parser adds joins a stand-in for each (standIn) and fetches only the pieces it keeps.
const FRAME = new Set([WHOLE, PNG_IMAGE, PNG_CARD, RISUM_MODULE, `${ZIP}card.json`, `${ZIP}module.risum`]);
export const isFrame = (path: string) => FRAME.has(path);

const STAND_IN = 'hazelle-original-piece:';
export const standIn = (path: string) => utf8.encode(STAND_IN + path);
// The piece a read answered with its stand-in; null for bytes the file holds.
export function stoodFor(bytes: Uint8Array): string | null {
  const read = text.decode(bytes.subarray(0, STAND_IN.length));
  return read === STAND_IN ? text.decode(bytes.subarray(STAND_IN.length)) : null;
}

const under = (parts: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, prefix: string) =>
  [...parts].flatMap(([path, bytes]): [string, Uint8Array<ArrayBuffer>][] => (path.startsWith(prefix) ? [[path.slice(prefix.length), bytes]] : []));

// A chunk that is not base64 was unreadable when imported too; kept as nothing, it reads as missing again.
function decoded(chunk: string): Uint8Array<ArrayBuffer> | null {
  try {
    return fromBase64(chunk);
  } catch {
    return null;
  }
}

function zipOf(bytes: Uint8Array<ArrayBuffer>) {
  try {
    return openZip(bytes);
  } catch {
    return null;
  }
}
