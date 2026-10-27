import { isRecord } from '../../connectors/values';
import { METADATA_BYTES, TooLarge } from './inflate';
import type { FileSource } from './source';

// RPack's decode table, ported under AGPL-3.0: bytes 256-511 of src/ts/rpack/rpack_map.bin in
// github.com/kwaroran/RisuAI at ca1345fca1b65f2f4eac976510b7753e290eaa98. It must equal
// `xxd -p -c 32 -s 256 rpack_map.bin` of that file line for line.
const RPACK = Uint8Array.from(
  [
    '2cf7848bc965fbb69faeb3032d0169741fe4a3ecee5c3421934a0f6ae262029e',
    '229cfd3cfc71c7c6ad596705706d8a4412fa24865fafd17a47cefe5063dd5106',
    '6f18e052a8099d56734cb8536cc3a00e19cf3e0d7e07326846ea48f9992eaba4',
    '49205e5535380cbcd3b1581679280a1ae1f2cdc439dba2ba6072767d95ef7fc8',
    'c0de3794bfb51481922545ace7f566a72b365ac113e34b3ae88d831b7c27b09a',
    '42eb87aadc548e7826d25729d4b7f82f8f8975f04177c21effd81511e5049717',
    'f331d09b00d7cab44f2a3bd9b26bda5da13f3061bd913d4ee6dfbe4d828c1d23',
    '109864f485337b9043bba988f1d6a51cf6cc6eb95b0b96edd5e9c5cb08a68040',
  ]
    .join('')
    .match(/../g)!,
  (pair) => parseInt(pair, 16),
);

// RPack table is a permutation; encode is its inverse. Keep .risum/.risup readers and writers aligned.
export const unpack = (bytes: Uint8Array) => bytes.map((byte) => RPACK[byte]!);
const PACK = new Uint8Array(256);
RPACK.forEach((plain, packed) => (PACK[plain] = packed));
export const pack = (bytes: Uint8Array) => bytes.map((byte) => PACK[byte]!);

const MAGIC = 111;
const VERSION = 0;
const HEADER = 6;

const ASSET = 1;

// Layout: magic/version/u32le JSON length, RPack JSON, ordered asset blocks (mark/u32le length/RPack bytes), zero.
// Read metadata eagerly but asset bytes lazily: modules can exceed memory. Keep whole blocks from truncated files.
export async function readRisum(source: FileSource): Promise<{ module: Record<string, unknown>; assets: (() => Promise<Uint8Array<ArrayBuffer>>)[] } | null> {
  if (source.size < HEADER) return null;
  const length = jsonLength(await source.read(0, HEADER));
  if (length === null || HEADER + length > source.size) return null;
  if (length > METADATA_BYTES) throw new TooLarge('entry-too-large');
  const module = moduleOf(await source.read(HEADER, length));
  if (!module) return null;
  const assets: (() => Promise<Uint8Array<ArrayBuffer>>)[] = [];
  for (let at = HEADER + length; at + 5 <= source.size; ) {
    const head = await source.read(at, 5);
    if (head[0] !== ASSET) break;
    const start = at + 5;
    const end = start + new DataView(head.buffer, head.byteOffset, 5).getUint32(1, true);
    if (end > source.size) break;
    assets.push(async () => unpack(await source.read(start, end - start)));
    at = end;
  }
  return { module, assets };
}

// The module of a .risum held in memory, as a charx's module.risum is; its blocks are not read.
export function readRisumModule(bytes: Uint8Array): Record<string, unknown> | null {
  const length = jsonLength(bytes);
  return length === null || HEADER + length > bytes.length ? null : moduleOf(bytes.subarray(HEADER, HEADER + length));
}

function jsonLength(head: Uint8Array): number | null {
  if (head.length < HEADER || head[0] !== MAGIC || head[1] !== VERSION) return null;
  return new DataView(head.buffer, head.byteOffset, HEADER).getUint32(2, true);
}

function moduleOf(packed: Uint8Array): Record<string, unknown> | null {
  let main: unknown;
  try {
    main = JSON.parse(new TextDecoder().decode(unpack(packed)));
  } catch {
    return null;
  }
  return isRecord(main) && main.type === 'risuModule' && isRecord(main.module) ? main.module : null;
}

// Write head, individual asset blocks, then end; never buffer the whole module.
// Block count/order must exactly match module.assets: Risu rejects even one unnamed block.
export function risumHead(module: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  const main = pack(new TextEncoder().encode(JSON.stringify({ module, type: 'risuModule' }, null, 2)));
  const bytes = new Uint8Array(HEADER + main.length);
  bytes.set([MAGIC, VERSION]);
  new DataView(bytes.buffer).setUint32(2, main.length, true);
  bytes.set(main, HEADER);
  return bytes;
}

export function risumBlock(file: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(5 + file.length);
  bytes[0] = ASSET;
  new DataView(bytes.buffer).setUint32(1, file.length, true);
  bytes.set(pack(file), 5);
  return bytes;
}

export const RISUM_END = Uint8Array.of(0);

// A .risum without pictures, as a charx's module.risum is.
export function writeRisum(module: Record<string, unknown>): Uint8Array<ArrayBuffer> {
  const head = risumHead(module);
  const bytes = new Uint8Array(head.length + RISUM_END.length);
  bytes.set(head);
  bytes.set(RISUM_END, head.length);
  return bytes;
}
