import { expect, it } from 'vitest';
import { hex, sha256Hex, sha256Id } from './hex';

it('writes two lowercase digits per byte, so stored names and ids keep their bytes', async () => {
  expect(hex(new Uint8Array([0, 1, 15, 16, 171, 255]))).toBe('00010f10abff');
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256Id('abc')).toBe('ba7816bf-8f01-cfea-4141-40de5dae2223');
});
