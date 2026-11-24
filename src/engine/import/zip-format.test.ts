import { strToU8 } from 'fflate';
import { expect, it } from 'vitest';
import { crc32 } from './zip-format';

it('reckons the CRC-32 that zip and PNG check, over a view into a larger buffer as well', () => {
  expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
  expect(crc32(strToU8('__123456789__').subarray(2, 11))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
});
