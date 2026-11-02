import { concat } from './inflate';
import { crc32 } from './zip';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const TEXT_KEYS = new Set(['chara', 'ccv3', 'persona']);
const ASSET = 'chara-ext-asset_';
const decoder = new TextDecoder();

export type Png = {
  // The card's base64 payload. ccv3 wins over chara.
  card: string | null;
  // A Risu persona's base64 payload (Risu's exportUserPersona); a card chunk beside it wins.
  persona: string | null;
  // The file without the card's or persona's tEXt chunks, ending at IEND: the stored picture is the image alone.
  image: Uint8Array<ArrayBuffer>;
  // The base64 files a card names `__asset:N`, by N: Risu writes each in a chunk `chara-ext-asset_:N` (older
  // cards: `chara-ext-asset_N`).
  assets: Map<string, string>;
};

// Only tEXt chunks carry a card; iTXt and zTXt are image metadata and stay in the image.
export function readPng(bytes: Uint8Array): Png | null {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new Map<string, string>();
  const assets = new Map<string, string>();
  const kept = [bytes.subarray(0, SIGNATURE.length)];
  let pos = SIGNATURE.length;
  while (pos + 12 <= bytes.length) {
    const end = pos + 12 + view.getUint32(pos);
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const chunk = bytes.subarray(pos, end);
    pos = end;
    if (type === 'tEXt') {
      const data = chunk.subarray(8, -4);
      const nul = data.indexOf(0);
      const key = nul === -1 ? '' : decoder.decode(data.subarray(0, nul));
      if (TEXT_KEYS.has(key)) {
        text.set(key, decoder.decode(data.subarray(nul + 1)));
        continue;
      }
      if (key.startsWith(ASSET)) {
        assets.set(key.slice(ASSET.length).replace(/^:/, ''), decoder.decode(data.subarray(nul + 1)));
        continue;
      }
    }
    kept.push(chunk);
    if (type === 'IEND') return { card: text.get('ccv3') || text.get('chara') || null, persona: text.get('persona') ?? null, image: concat(kept), assets };
  }
  return null;
}

const IEND = 12;

// The PNG with a tEXt chunk key = value before its IEND, which must be its last 12 bytes, as a canvas writes it. Both
// are Latin-1, as tEXt is; a base64 value always is.
export function withText(png: Uint8Array, key: string, value: string): Uint8Array<ArrayBuffer> {
  const end = png.length - IEND;
  if (end < SIGNATURE.length || String.fromCharCode(...png.subarray(end + 4, end + 8)) !== 'IEND') throw new TypeError('the PNG does not end in IEND');
  const data = Uint8Array.from(`tEXt${key}\0${value}`, (char) => char.charCodeAt(0));
  const chunk = new Uint8Array(data.length + 8);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length - 4);
  chunk.set(data, 4);
  view.setUint32(chunk.length - 4, crc32(data));
  return concat([png.subarray(0, end), chunk, png.subarray(end)]);
}
