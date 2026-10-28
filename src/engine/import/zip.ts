import { deflateSync } from 'fflate';
import { expansionLimit, inflate, TooLarge } from './inflate';
import { u16, u32, ZipDirectory, zipEnd, zipRange, zipDataStart, ZipIntegrity } from './zip-format';

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD = 22;
const STORED = 0;
const DEFLATED = 8;

export type Zip = {
  // Whatever precedes the archive: the image of a JPEG with an appended zip.
  prefix: Uint8Array<ArrayBuffer>;
  // Lazy bytes keep large archives out of memory; enforce limit before unpacking.
  // Null means missing, damaged or unsupported entry.
  read(path: string, limit?: number): Uint8Array<ArrayBuffer> | null;
};

// Appended ZIP offsets are relative to its own start, derived from the central directory.
// Validate declared sizes against the archive limit before inflate enforces each entry's size.
export function openZip(bytes: Uint8Array<ArrayBuffer>): Zip | null {
  try {
    const record = zipEnd(bytes);
    const directorySize = u32(bytes, record + 12);
    const directoryStart = record - directorySize;
    const start = directoryStart - u32(bytes, record + 16);
    if (start < 0) return null;
    const count = u16(bytes, record + 10);
    const directory = new ZipDirectory(count, directoryStart, directorySize, record, start);
    for (let i = 0; i < count; i++) {
      const at = directory.offset;
      const header = bytes.subarray(at, at + directory.headerSize());
      const length = directory.variableSize(header);
      directory.add(header, bytes.subarray(at + 46, at + 46 + length));
    }
    let unpacked = 0;
    for (const entry of directory.entries.values()) if (entry.method === DEFLATED) unpacked += entry.size;
    if (unpacked > expansionLimit(bytes.length)) throw new TooLarge('expands-too-far');
    const entries = directory.finish();
    return {
      prefix: bytes.slice(0, start),
      read: (path, limit = Infinity) => {
        const entry = entries.get(path);
        if (!entry) return null;
        if (Math.max(entry.size, entry.compressed) > limit) throw new TooLarge('entry-too-large');
        try {
          zipRange(entry.offset, 30, directoryStart);
          const from = zipDataStart(bytes.subarray(entry.offset, entry.offset + 30), entry, directoryStart);
          const packed = bytes.subarray(from, from + entry.compressed);
          const data = entry.method === STORED ? packed : inflate(packed, entry.size);
          const integrity = new ZipIntegrity(entry);
          integrity.push(data);
          integrity.finish();
          return data;
        } catch {
          return null;
        }
      },
    };
  } catch (error) {
    if (error instanceof TooLarge) throw error;
    return null;
  }
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export const crc32 = (bytes: Uint8Array) => (bytes.reduce((c, byte) => CRC[(c ^ byte) & 0xff]! ^ (c >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
const UTF8_NAMES = 0x800;
const encoder = new TextEncoder();

export type ZipWriter = { add(path: string, bytes: Uint8Array<ArrayBuffer>, deflate?: boolean): Promise<void>; end(): Promise<void> };

// Never write data descriptors: Risu's streaming Unzip searches for their signature and can cut matching image bytes.
// Write whole entries with sizes in local headers. Refuse ZIP64-sized archives rather than corrupting counts/offsets.
export function zipWriter(write: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>): ZipWriter {
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const out = async (bytes: Uint8Array<ArrayBuffer>) => {
    if (offset + bytes.length > 0xffffffff) throw new RangeError('the archive is past 4 GiB');
    await write(bytes);
    offset += bytes.length;
  };
  return {
    async add(path, bytes, deflate = false) {
      const name = encoder.encode(path);
      const data = deflate ? (deflateSync(bytes) as Uint8Array<ArrayBuffer>) : bytes;
      const crc = crc32(bytes);
      const header = new Uint8Array(30 + name.length);
      const local = new DataView(header.buffer);
      local.setUint32(0, LOCAL_HEADER, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, UTF8_NAMES, true);
      local.setUint16(8, deflate ? DEFLATED : STORED, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, name.length, true);
      header.set(name, 30);
      const entry = new Uint8Array(46 + name.length);
      const central = new DataView(entry.buffer);
      central.setUint32(0, DIRECTORY_ENTRY, true);
      central.setUint16(4, 20, true);
      entry.set(header.subarray(4, 30), 6);
      central.setUint32(42, offset, true);
      entry.set(name, 46);
      directory.push(entry);
      await out(header);
      await out(data);
    },
    async end() {
      if (directory.length > 0xffff) throw new RangeError('more files than an archive without ZIP64 holds');
      const start = offset;
      for (const entry of directory) await out(entry);
      const record = new Uint8Array(END_RECORD);
      const end = new DataView(record.buffer);
      end.setUint32(0, END_OF_DIRECTORY, true);
      end.setUint16(8, directory.length, true);
      end.setUint16(10, directory.length, true);
      end.setUint32(12, offset - start, true);
      end.setUint32(16, start, true);
      await out(record);
    },
  };
}
