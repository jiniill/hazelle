import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importCard, importRisum } from './card';
import { concat } from './inflate';
import { joinOriginal, originalParts, risumParts } from './original';
import { withText } from './png';
import { risumBlock, risumHead, RISUM_END } from './risum';
import type { FileSource } from './source';
import { crc32 } from './zip';

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
const image = () => concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])), chunk('IDAT', new Uint8Array([1, 2, 3])), chunk('IEND', new Uint8Array())]);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const own = (bytes: Uint8Array) => new Uint8Array(bytes);
const bytesSource = (bytes: Uint8Array<ArrayBuffer>): FileSource => ({ size: bytes.length, read: async (offset, length) => bytes.slice(offset, offset + length) });
const picture = own(image());

const card = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Mira', description: 'd', first_mes: 'hi',
    assets: [
      { type: 'icon', name: 'main', uri: 'ccdefault:', ext: 'png' },
      { type: 'x-risu-asset', name: 'smile', uri: 'embeded://assets/other/smile.png', ext: 'png' },
      { type: 'emotion', name: 'sad', uri: 'embeded://assets/emotion/sad.png', ext: 'png' },
    ],
    extensions: { risuai: { additionalText: 'later' } },
  },
};

// What a parse holds, with each asset's bytes read: the stored values and what was counted.
async function read(result: ReturnType<typeof importCard> | Awaited<ReturnType<typeof importRisum>>) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  const held = 'card' in result ? result.card : 'module' in result ? result.module : null;
  if (!held) throw new Error('not a card or module');
  return { ...held, assets: await Promise.all(held.assets.map(async ({ name, read }) => [name, await read()])) };
}

async function kept(parts: ReturnType<typeof originalParts>) {
  return new Map((await Promise.all(parts.map(async ({ path, read }) => [path, await read()] as const))).flatMap(([path, bytes]) => (bytes ? [[path, bytes] as const] : [])));
}

describe('joinOriginal', () => {
  it('rebuilds a charx that reads as the original, its dropped pictures included', async () => {
    const zip = own(zipSync({ 'card.json': strToU8(JSON.stringify(card)), 'assets/other/smile.png': picture, 'assets/emotion/sad.png': own(strToU8('sad')) }));
    const file = concat([picture, zip]);
    const parts = originalParts(file);
    expect(parts.map(({ path }) => path)).toEqual(['zip-prefix', 'zip/card.json', 'zip/assets/other/smile.png', 'zip/assets/emotion/sad.png']);
    const joined = await joinOriginal(await kept(parts));
    expect(await read(importCard('bot.charx', joined))).toEqual(await read(importCard('bot.charx', file)));
  });

  it('rebuilds a card PNG from its image, its card and its decoded asset chunks', async () => {
    const v2 = { ...card, spec: 'chara_card_v2', data: { ...card.data, assets: undefined, extensions: { risuai: { additionalAssets: [['smile', '__asset:0', 'png']] } } } };
    const file = withText(withText(picture, 'chara', base64(strToU8(JSON.stringify(v2)))), 'chara-ext-asset_:0', base64(picture));
    const parts = await kept(originalParts(file));
    expect(parts.get('png-asset/0')).toEqual(picture);
    expect(await read(importCard('bot.png', await joinOriginal(parts)))).toEqual(await read(importCard('bot.png', file)));
  });

  it('rebuilds a .risum with its blocks in order', async () => {
    const module = { name: 'pack', description: '', assets: [['a', '', 'png'], ['b', '', 'png']], cjs: 'x' };
    const file = concat([risumHead(module), risumBlock(picture), risumBlock(own(strToU8('b'))), RISUM_END]);
    const parts = await kept(await risumParts(bytesSource(file)));
    const joined = await joinOriginal(new Map([...parts].reverse()));
    expect(await read(await importRisum(bytesSource(joined)))).toEqual(await read(await importRisum(bytesSource(file))));
  });

  it('keeps any other file whole', async () => {
    const file = own(strToU8(JSON.stringify(card)));
    expect(await joinOriginal(await kept(originalParts(file)))).toEqual(file);
  });
});
