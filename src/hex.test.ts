import { expect, it } from 'vitest';
import { hex } from './hex';

it('writes two lowercase digits per byte, so stored names and ids keep their bytes', async () => {
  expect(hex(new Uint8Array([0, 1, 15, 16, 171, 255]))).toBe('00010f10abff');
  expect(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'))))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
