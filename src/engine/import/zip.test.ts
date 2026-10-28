import { strToU8, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { openZip } from './zip';

const archive = () => zipSync({ 'card.json': strToU8('hello'), 'other.txt': strToU8('world') }, { level: 0 }) as Uint8Array<ArrayBuffer>;
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const central = (bytes: Uint8Array) => view(bytes).getUint32(bytes.length - 6, true);

it('rejects a changed payload whose stored CRC was left intact', () => {
  const bytes = archive();
  expect(new TextDecoder().decode(openZip(bytes)!.read('card.json')!)).toBe('hello');
  const payload = 30 + 'card.json'.length;
  bytes[payload] = bytes[payload]! ^ 1;
  expect(openZip(bytes)!.read('card.json')).toBeNull();
});

it('rejects a stored entry whose actual length differs from the declared length', () => {
  const bytes = archive();
  view(bytes).setUint32(central(bytes) + 24, 6, true);
  expect(openZip(bytes)!.read('card.json')).toBeNull();
});

it('rejects directory entries extending past their declared directory bounds', () => {
  const bytes = archive();
  view(bytes).setUint16(central(bytes) + 32, 65535, true);
  expect(openZip(bytes)).toBeNull();
});

it('rejects duplicate names instead of silently choosing the last entry', () => {
  const bytes = archive();
  bytes.set(strToU8('card.json'), central(bytes) + 46 + 'card.json'.length + 46);
  expect(openZip(bytes)).toBeNull();
});
