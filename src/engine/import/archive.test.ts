import { strToU8, zipSync } from 'fflate';
import { expect, it } from 'vitest';
import { unpackZip } from './archive';
import { openZip } from './zip';

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0]);
const zip = (files: Record<string, Uint8Array>) => new Uint8Array(zipSync(files)) as Uint8Array<ArrayBuffer>;
const names = (bytes: Uint8Array<ArrayBuffer>) => {
  const unpacked = unpackZip('bot.zip', bytes);
  return unpacked.ok ? { files: unpacked.files.map(({ name }) => name), skipped: unpacked.skipped } : unpacked;
};

it('takes importable files from any folder, tells what it left, and hides what a zipper added', () => {
  expect(names(zip({
    'bot/bot.charx': strToU8('x'),
    'bot/module.risum': strToU8('x'),
    'readme.txt': strToU8('x'),
    'cover.png': PNG,
    'inner.zip': strToU8('x'),
    '__MACOSX/bot/._bot.charx': strToU8('x'),
    'bot/.DS_Store': strToU8('x'),
    'bot/': new Uint8Array(),
  }))).toEqual({ files: ['bot.charx', 'module.risum'], skipped: ['readme.txt', 'cover.png', 'inner.zip'] });
});

it('reads a renamed charx as a charx, not as its own files', () => {
  const bytes = zip({ 'card.json': strToU8('{}'), 'assets/face.png': PNG });
  const unpacked = unpackZip('Bot.ZIP', bytes);
  expect(unpacked).toEqual({ ok: true, files: [{ name: 'Bot.charx', bytes }], skipped: [] });
});

it('tells an encrypted zip from a broken one', () => {
  const encrypted = zip({ 'bot.charx': strToU8('x') });
  const view = new DataView(encrypted.buffer);
  for (let at = 0; at + 4 <= encrypted.length; at++) if (view.getUint32(at, true) === 0x02014b50) view.setUint16(at + 8, 1, true);
  expect(unpackZip('bot.zip', encrypted)).toEqual({ ok: false, failure: 'encrypted' });
  expect(unpackZip('bot.zip', strToU8('not a zip') as Uint8Array<ArrayBuffer>)).toEqual({ ok: false, failure: 'unreadable' });
});

it('keeps two CP949 names apart', () => {
  const bytes = zip({ AA: strToU8('1'), BB: strToU8('2') });
  const replace = (from: string, to: number[]) => {
    for (let at = 0; at + 2 <= bytes.length; at++) if (bytes[at] === from.charCodeAt(0) && bytes[at + 1] === from.charCodeAt(1)) bytes.set(to, at);
  };
  replace('AA', [0xb0, 0xa1]);
  replace('BB', [0xb3, 0xaa]);
  expect(openZip(bytes)?.names).toEqual(['가', '나']);
});
