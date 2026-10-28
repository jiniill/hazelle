import { ZipPassThrough } from 'fflate';

export type ZipEntry = { name: string; offset: number; compressed: number; size: number; method: number; crc: number };

const MAX32 = 0xffffffff;
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export const u16 = (bytes: Uint8Array, at: number) => view(bytes).getUint16(at, true);
export const u32 = (bytes: Uint8Array, at: number) => view(bytes).getUint32(at, true);
export const u64 = (bytes: Uint8Array, at: number) => {
  const value = Number(view(bytes).getBigUint64(at, true));
  if (!Number.isSafeInteger(value)) throw new Error('ZIP offset is too large');
  return value;
};

export function zipRange(offset: number, length: number, limit: number) {
  if (offset < 0 || length < 0 || offset + length > limit) throw new Error('ZIP ends early');
}

export function zipEnd(tail: Uint8Array) {
  const floor = Math.max(0, tail.length - 65557);
  let end = tail.length - 22;
  while (end >= floor && (u32(tail, end) !== 0x06054b50 || end + 22 + u16(tail, end + 20) !== tail.length)) end--;
  if (end < floor || u32(tail, end + 4) !== 0 || u16(tail, end + 8) !== u16(tail, end + 10)) throw new Error('Not a single-disk ZIP');
  return end;
}

export class ZipDirectory {
  readonly entries = new Map<string, ZipEntry>();
  readonly limit: number;

  constructor(private readonly count: number, public offset: number, size: number, end: number, private readonly base = 0) {
    zipRange(offset, size, end);
    if (count > size / 46) throw new Error('Bad ZIP directory');
    this.limit = offset + size;
  }

  headerSize() {
    zipRange(this.offset, 46, this.limit);
    return 46;
  }

  variableSize(header: Uint8Array) {
    if (u32(header, 0) !== 0x02014b50 || (u16(header, 8) & 1) || u16(header, 34) !== 0) throw new Error('Bad ZIP entry');
    const length = u16(header, 28) + u16(header, 30) + u16(header, 32);
    zipRange(this.offset + 46, length, this.limit);
    return length;
  }

  add(header: Uint8Array, variable: Uint8Array) {
    const method = u16(header, 10);
    if (method !== 0 && method !== 8) throw new Error('Unknown ZIP compression');
    const nameLength = u16(header, 28);
    const extraEnd = nameLength + u16(header, 30);
    const name = new TextDecoder().decode(variable.subarray(0, nameLength));
    let size = u32(header, 24);
    let compressed = u32(header, 20);
    let local = u32(header, 42);
    for (let at = nameLength; at < extraEnd;) {
      zipRange(at, 4, extraEnd);
      const end = at + 4 + u16(variable, at + 2);
      zipRange(at, end - at, extraEnd);
      if (u16(variable, at) === 1) {
        let field = at + 4;
        const next = () => { zipRange(field, 8, end); const value = u64(variable, field); field += 8; return value; };
        if (size === MAX32) size = next();
        if (compressed === MAX32) compressed = next();
        if (local === MAX32) local = next();
      }
      at = end;
    }
    if (this.entries.has(name)) throw new Error('Bad ZIP entry');
    this.entries.set(name, { name, offset: this.base + local, size, compressed, method, crc: u32(header, 16) });
    this.offset += 46 + variable.length;
  }

  finish() {
    if (this.offset !== this.limit || this.entries.size !== this.count) throw new Error('Bad ZIP directory size');
    for (const entry of this.entries.values()) {
      if (entry.size === MAX32 || entry.compressed === MAX32 || entry.offset - this.base === MAX32) throw new Error('Bad ZIP entry');
    }
    return this.entries;
  }
}

export function zipDataStart(header: Uint8Array, entry: ZipEntry, limit: number) {
  if (u32(header, 0) !== 0x04034b50 || (u16(header, 6) & 1) || u16(header, 8) !== entry.method) throw new Error('Bad ZIP header');
  const start = entry.offset + 30 + u16(header, 26) + u16(header, 28);
  zipRange(start, entry.compressed, limit);
  return start;
}

export class ZipIntegrity {
  private readonly checksum = new ZipPassThrough('');
  private size = 0;

  constructor(private readonly entry: Pick<ZipEntry, 'size' | 'crc'>) {
    this.checksum.ondata = () => {};
  }

  push(chunk: Uint8Array) {
    this.size += chunk.length;
    if (this.size > this.entry.size) throw new Error('Bad ZIP size');
    this.checksum.push(chunk);
  }

  finish() {
    this.checksum.push(new Uint8Array(), true);
    if (this.size !== this.entry.size || (this.checksum.crc >>> 0) !== this.entry.crc) throw new Error('Bad ZIP checksum');
  }
}
