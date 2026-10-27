import { Gunzip, Inflate } from 'fflate';
import { progressed } from '../progress';

// DEFLATE expands at most 1032× per input step, bounding how far output can overrun its declared size.
const STEP = 64 * 1024;

// Real archives peaked at 3.3× (picture charx), databases at 2.8×; retain a floor for small text files.
export const EXPANSION = 16;
const FLOOR = 64 * 1024 * 1024;
export const expansionLimit = (packed: number) => packed * EXPANSION + FLOOR;

// What one file of a card's or module's text may hold (card.json, module.risum, a .risum's JSON); the largest real
// ones hold 1.2 MB.
export const METADATA_BYTES = 16_000_000;

// A file past a limit, refused before more of it is unpacked or parsed. The message is the import failure's detail.
export class TooLarge extends RangeError {
  constructor(message: 'expands-too-far' | 'entry-too-large') {
    super(message);
  }
}

// Grow incrementally; never allocate the untrusted declared size. Require exact final size and abort past limit.
function drain(stream: Inflate | Gunzip, packed: Uint8Array, size: number, limit: number): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  stream.ondata = (chunk) => {
    total += chunk.length;
    if (total > size) throw new RangeError('more data than declared');
    if (total > limit) throw new TooLarge('expands-too-far');
    chunks.push(chunk);
  };
  for (let at = 0; at < packed.length; at += STEP) {
    stream.push(packed.subarray(at, at + STEP), at + STEP >= packed.length);
    progressed();
  }
  if (total !== size) throw new RangeError('less data than declared');
  return concat(chunks);
}

// A raw DEFLATE stream, as a ZIP entry holds one; size is what the archive's directory declares for its output, which
// openZip holds to the archive's limit.
export const inflate = (packed: Uint8Array, size: number) => drain(new Inflate(), packed, size, size);

// Do not reject by gzip trailer size alone: damaged/cut files have arbitrary trailing bytes.
export const gunzip = (file: Uint8Array, limit: number) =>
  drain(new Gunzip(), file, new DataView(file.buffer, file.byteOffset, file.byteLength).getUint32(file.length - 4, true), limit);

export function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
