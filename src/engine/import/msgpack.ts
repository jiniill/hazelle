import { concat } from './inflate';

// Not fatal: msgpackr writes a lone surrogate in a short string as three bytes and reads them back, so one cut
// emoji in a Risu chat must not make the whole database unreadable.
const utf8 = new TextDecoder();

// MessagePack as Risu writes its presets and database (msgpackr): the standard types, and msgpackr's one extension,
// d4 00 00 for undefined. Anything else, or bytes that end early, throws.
export function readMsgpack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  // subarray clamps at the end instead of throwing, so the length is checked here.
  const next = (length: number) => {
    const start = at;
    at += length;
    if (at > bytes.length) throw new RangeError('MessagePack ends early');
    return start;
  };
  const str = (length: number) => utf8.decode(bytes.subarray(next(length), at));
  const bin = (length: number) => bytes.slice(next(length), at);
  const array = (length: number) => Array.from({ length }, () => value());
  // fromEntries rather than assignment, so a key named __proto__ stays a plain key.
  const map = (length: number) =>
    Object.fromEntries(
      Array.from({ length }, () => {
        const key = value();
        if (typeof key !== 'string') throw new TypeError('MessagePack map key is not a string');
        return [key, value()];
      }),
    );

  function value(): unknown {
    const type = view.getUint8(next(1));
    if (type < 0x80) return type;
    if (type >= 0xe0) return type - 0x100;
    if (type < 0x90) return map(type & 0x0f);
    if (type < 0xa0) return array(type & 0x0f);
    if (type < 0xc0) return str(type & 0x1f);
    switch (type) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return bin(view.getUint8(next(1)));
      case 0xc5:
        return bin(view.getUint16(next(2)));
      case 0xc6:
        return bin(view.getUint32(next(4)));
      case 0xca:
        return view.getFloat32(next(4));
      case 0xcb:
        return view.getFloat64(next(8));
      case 0xcc:
        return view.getUint8(next(1));
      case 0xcd:
        return view.getUint16(next(2));
      case 0xce:
        return view.getUint32(next(4));
      case 0xcf:
        return Number(view.getBigUint64(next(8)));
      case 0xd0:
        return view.getInt8(next(1));
      case 0xd1:
        return view.getInt16(next(2));
      case 0xd2:
        return view.getInt32(next(4));
      case 0xd3:
        return Number(view.getBigInt64(next(8)));
      case 0xd4:
        if (view.getUint16(next(2)) === 0) return undefined;
        break;
      case 0xd9:
        return str(view.getUint8(next(1)));
      case 0xda:
        return str(view.getUint16(next(2)));
      case 0xdb:
        return str(view.getUint32(next(4)));
      case 0xdc:
        return array(view.getUint16(next(2)));
      case 0xdd:
        return array(view.getUint32(next(4)));
      case 0xde:
        return map(view.getUint16(next(2)));
      case 0xdf:
        return map(view.getUint32(next(4)));
    }
    throw new TypeError(`MessagePack type 0x${type.toString(16)} is not read`);
  }

  return value();
}

const utf8Out = new TextEncoder();
type Widths = [number | null, number, number];

// Write smallest standard forms; omit undefined object fields, never turn them into nil.
// Only explicit null becomes nil (preset export ruling 9).
export function writeMsgpack(value: unknown): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const head = (type: number, bytes: 0 | 1 | 2 | 4 | 8, set?: (view: DataView) => void) => {
    const part = new Uint8Array(1 + bytes);
    part[0] = type;
    set?.(new DataView(part.buffer, 1));
    parts.push(part);
  };
  // fix: the type a length below limit is or'd into; then the 8-, 16- and 32-bit length forms.
  const length = (n: number, fix: number | null, limit: number, [w8, w16, w32]: Widths) => {
    if (fix !== null && n < limit) head(fix | n, 0);
    else if (w8 !== null && n < 0x100) head(w8, 1, (view) => view.setUint8(0, n));
    else if (n < 0x10000) head(w16, 2, (view) => view.setUint16(0, n));
    else head(w32, 4, (view) => view.setUint32(0, n));
  };

  // An integer past 32 bits goes as a float, as msgpackr writes it: msgpackr reads a 64-bit integer as a BigInt.
  function number(n: number) {
    if (!Number.isInteger(n) || n >= 0x100000000 || n < -0x80000000) return head(0xcb, 8, (view) => view.setFloat64(0, n));
    if (n >= 0) {
      if (n < 0x80) return head(n, 0);
      if (n < 0x100) return head(0xcc, 1, (view) => view.setUint8(0, n));
      if (n < 0x10000) return head(0xcd, 2, (view) => view.setUint16(0, n));
      return head(0xce, 4, (view) => view.setUint32(0, n));
    }
    if (n >= -32) return head(n & 0xff, 0);
    if (n >= -0x80) return head(0xd0, 1, (view) => view.setInt8(0, n));
    if (n >= -0x8000) return head(0xd1, 2, (view) => view.setInt16(0, n));
    head(0xd2, 4, (view) => view.setInt32(0, n));
  }

  function string(text: string) {
    const bytes = utf8Out.encode(text);
    length(bytes.length, 0xa0, 32, [0xd9, 0xda, 0xdb]);
    parts.push(bytes);
  }

  function write(item: unknown) {
    if (item === null) return head(0xc0, 0);
    if (typeof item === 'boolean') return head(item ? 0xc3 : 0xc2, 0);
    if (typeof item === 'number') return number(item);
    if (typeof item === 'string') return string(item);
    if (item instanceof Uint8Array) {
      length(item.length, null, 0, [0xc4, 0xc5, 0xc6]);
      return parts.push(item);
    }
    if (Array.isArray(item)) {
      length(item.length, 0x90, 16, [null, 0xdc, 0xdd]);
      return item.forEach(write);
    }
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      const entries = Object.entries(item).filter(([, entry]) => entry !== undefined);
      length(entries.length, 0x80, 16, [null, 0xde, 0xdf]);
      for (const [key, entry] of entries) {
        string(key);
        write(entry);
      }
      return;
    }
    throw new TypeError(`MessagePack does not write ${typeof item}`);
  }

  write(value);
  return concat(parts);
}
