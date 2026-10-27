import { Unzlib } from 'fflate';
import { isRecord } from '../../connectors/values';
import { concat } from './inflate';

// Read NovelAI prompt JSON only from PNG Comment (tEXt/zTXt) or WebP EXIF UserComment/ImageDescription.
// UserComment requires ASCII\0\0\0; other generators' plain text and XMP are not prompts.
// Alpha metadata survived only 5/39,649 pictures (127 bots, 2026-10-11), so do not scan it.
// prompt uses V4 base caption or the full prompt; characters uses V4 per-character captions.
export type PicturePrompt = { prompt: string; characters: string[] };

const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const ASCII = 'ASCII\0\0\0';
// A Comment past this unpacked is no prompt.
const TEXT_MOST = 256 * 1024;
const decoder = new TextDecoder();

export function picturePrompt(bytes: Uint8Array): PicturePrompt | null {
  for (const text of texts(bytes)) {
    const prompt = promptOf(text);
    if (prompt) return prompt;
  }
  return null;
}

function texts(bytes: Uint8Array): string[] {
  if (bytes.length >= PNG.length && PNG.every((byte, i) => bytes[i] === byte)) return pngComments(bytes);
  const exif = webpChunk(bytes, 'EXIF');
  return exif ? exifTexts(exif) : [];
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const fourcc = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

function pngComments(bytes: Uint8Array): string[] {
  const data = view(bytes);
  const found: string[] = [];
  for (let at = PNG.length; at + 12 <= bytes.length; ) {
    const length = data.getUint32(at);
    const type = fourcc(bytes, at + 4);
    const body = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length));
    at += 12 + length;
    if (type === 'IEND') break;
    if (type !== 'tEXt' && type !== 'zTXt') continue;
    const nul = body.indexOf(0);
    if (nul === -1 || decoder.decode(body.subarray(0, nul)) !== 'Comment') continue;
    // zTXt: one byte for the compression method (0, zlib), then the packed text.
    const text = type === 'tEXt' ? decoder.decode(body.subarray(nul + 1)) : unpacked(body.subarray(nul + 2));
    if (text !== null) found.push(text);
  }
  return found;
}

function unpacked(packed: Uint8Array): string | null {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > TEXT_MOST) throw new RangeError('too long');
    chunks.push(chunk);
  });
  try {
    stream.push(packed, true);
  } catch {
    return null;
  }
  return decoder.decode(concat(chunks));
}

function webpChunk(bytes: Uint8Array, wanted: string): Uint8Array | null {
  if (bytes.length < 12 || fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'WEBP') return null;
  const data = view(bytes);
  for (let at = 12; at + 8 <= bytes.length; ) {
    const length = data.getUint32(at + 4, true);
    if (fourcc(bytes, at) === wanted) return bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + length));
    at += 8 + length + (length & 1);
  }
  return null;
}

const IMAGE_DESCRIPTION = 0x010e;
const EXIF_IFD = 0x8769;
const USER_COMMENT = 0x9286;
// The byte size of one value of each TIFF type this reads: ASCII, LONG, UNDEFINED.
const SIZES: Record<number, number> = { 2: 1, 4: 4, 7: 1 };

// A TIFF block, as WebP's EXIF chunk holds one (some writers lead it with `Exif\0\0`).
function exifTexts(chunk: Uint8Array): string[] {
  const tiff = decoder.decode(chunk.subarray(0, 6)) === 'Exif\0\0' ? chunk.subarray(6) : chunk;
  if (tiff.length < 8) return [];
  const little = tiff[0] === 0x49;
  const data = view(tiff);
  const found: string[] = [];
  const entries = (at: number, depth: number) => {
    if (at + 2 > tiff.length || depth > 1) return;
    const count = data.getUint16(at, little);
    for (let index = 0; index < count; index++) {
      const entry = at + 2 + index * 12;
      if (entry + 12 > tiff.length) return;
      const tag = data.getUint16(entry, little);
      const size = (SIZES[data.getUint16(entry + 2, little)] ?? 0) * data.getUint32(entry + 4, little);
      const offset = size <= 4 ? entry + 8 : data.getUint32(entry + 8, little);
      if (tag === EXIF_IFD) entries(data.getUint32(entry + 8, little), depth + 1);
      else if (tag === IMAGE_DESCRIPTION || tag === USER_COMMENT) {
        const text = decoder.decode(tiff.subarray(offset, offset + size));
        found.push(text.startsWith(ASCII) ? text.slice(ASCII.length) : text);
      }
    }
  };
  entries(data.getUint32(4, little), 0);
  return found;
}

const isText = (value: unknown): value is string => typeof value === 'string';

function promptOf(text: string): PicturePrompt | null {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/\0+$/, ''));
  } catch {
    return null;
  }
  if (!isRecord(value) || !isText(value.prompt)) return null;
  const caption = isRecord(value.v4_prompt) && isRecord(value.v4_prompt.caption) ? value.v4_prompt.caption : null;
  const base = caption && isText(caption.base_caption) ? caption.base_caption : value.prompt;
  const characters = caption && Array.isArray(caption.char_captions) ? caption.char_captions.flatMap((each) => (isRecord(each) && isText(each.char_caption) && each.char_caption.trim() ? [each.char_caption.trim()] : [])) : [];
  return { prompt: base.trim(), characters };
}

// Preserve artist spans with their weights, including comma-separated weighted groups.
// Never extract from negative prompts, which name artists to avoid.
export function artistTags(prompt: string): string[] {
  const stretches: string[] = [];
  let start = 0;
  let depth = 0;
  let weighted = false;
  const cut = (end: number) => {
    stretches.push(prompt.slice(start, end).trim());
    start = end;
  };
  for (let at = 0; at < prompt.length; at++) {
    const char = prompt[at]!;
    if ('{[('.includes(char)) depth++;
    else if ('}])'.includes(char)) depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0 && !weighted) {
      cut(at);
      start = at + 1;
    } else if (char === ':' && prompt[at + 1] === ':') {
      at++;
      // A number right before `::` opens a weighted span, the next `::` closes it; any other `::` is left as text.
      if (weighted) {
        weighted = false;
        cut(at + 1);
      } else if (/^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(prompt.slice(start, at - 1))) weighted = true;
    }
  }
  cut(prompt.length);
  return stretches.filter((stretch) => /artist\s*:/i.test(stretch));
}
