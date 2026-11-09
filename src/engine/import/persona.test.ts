import { expect, it } from 'vitest';
import { importCard } from './card';
import { writePersonaPng } from './persona';
import { crc32 } from './zip';

// Signature, IHDR and IEND; CRCs are zero, which neither reader checks.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0]);

// Risu's reading rule (persona.ts:104-144, pngChunk.ts:178-215 at 454e5e2): walk the chunks, take a tEXt key up to its
// NUL within the first 70 bytes, no CRC check, and parse the value of key `persona` as base64 of UTF-8 JSON.
function risuReads(bytes: Uint8Array): { persona: unknown; crcHolds: boolean } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let pos = 8; pos + 12 <= bytes.length; ) {
    const length = view.getUint32(pos);
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)) === 'tEXt') {
      const nul = data.subarray(0, 70).indexOf(0);
      if (String.fromCharCode(...data.subarray(0, nul)) === 'persona') {
        const json = new TextDecoder().decode(Uint8Array.from(atob(String.fromCharCode(...data.subarray(nul + 1))), (char) => char.charCodeAt(0)));
        return { persona: JSON.parse(json), crcHolds: crc32(bytes.subarray(pos + 4, pos + 8 + length)) === view.getUint32(pos + 8 + length) };
      }
    }
    pos += 12 + length;
  }
  return null;
}

it("writes a persona PNG that Risu's rule reads and the app's import reads back, the picture without the chunk", async () => {
  const persona = { name: '하루 🐶', description: '키가 크고\n말이 적어요.', alias: '노트' };
  const written = writePersonaPng(PNG, persona);
  expect(risuReads(written)).toEqual({ persona: { name: '하루 🐶', personaPrompt: '키가 크고\n말이 적어요.', note: '노트' }, crcHolds: true });
  const read = await importCard('하루.png', written);
  if (!read.ok || !('persona' in read)) throw new Error(`import failed: ${JSON.stringify(read)}`);
  expect(read.persona).toMatchObject(persona);
  expect(await read.persona.picture()).toEqual({ bytes: PNG, type: 'image/png' });
});
