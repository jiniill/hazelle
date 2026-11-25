import type { Spoken } from './types';

// One file of a reading's stretches, read in turn. MP3 is a run of frames, so stretches join end to end; a WAV
// stretch is its header and its samples, so the samples join under the first one's header. null: stretches of differing
// types, a WAV that is not plain PCM in one data chunk, or a type neither.
export function joinAudio(parts: readonly Spoken[]): Spoken | null {
  const [first] = parts;
  if (!first || parts.some(({ type }) => type !== first.type)) return null;
  if (parts.length === 1) return first;
  if (first.type === 'audio/mpeg') return { bytes: concat(parts.map(({ bytes }) => bytes)), type: first.type };
  if (first.type !== 'audio/wav') return null;
  const read = parts.map(({ bytes }) => wav(bytes));
  if (read.some((each) => each === null || !same(each.format, read[0]!.format))) return null;
  const samples = concat(read.map((each) => each!.samples));
  const format = read[0]!.format;
  const header = new Uint8Array(20 + format.byteLength + 8);
  const view = new DataView(header.buffer);
  header.set(ascii('RIFF'), 0);
  view.setUint32(4, header.byteLength - 8 + samples.byteLength, true);
  header.set(ascii('WAVE'), 8);
  header.set(ascii('fmt '), 12);
  view.setUint32(16, format.byteLength, true);
  header.set(format, 20);
  header.set(ascii('data'), 20 + format.byteLength);
  view.setUint32(24 + format.byteLength, samples.byteLength, true);
  return { bytes: concat([header, samples]), type: first.type };
}

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
const same = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

function concat(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined;
}

// A streamed WAV may give its data chunk a size past the file's end; the samples are what the file holds.
function wav(bytes: Uint8Array): { format: Uint8Array; samples: Uint8Array } | null {
  if (bytes.byteLength < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let format: Uint8Array | null = null;
  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const size = view.getUint32(at + 4, true);
    const body = bytes.subarray(at + 8, Math.min(at + 8 + size, bytes.byteLength));
    if (tag(bytes, at) === 'fmt ') format = body;
    if (tag(bytes, at) === 'data') return format && format.byteLength >= 16 && new DataView(format.buffer, format.byteOffset).getUint16(0, true) === 1 ? { format, samples: body } : null;
    at += 8 + size + (size % 2);
  }
  return null;
}
