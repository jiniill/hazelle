import { gzipSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { risumBlock, risumHead, RISUM_END } from '../../engine/import/risum';
import type { RisuMessage } from '../../engine/import/types';
import { fromBase64 } from '../../base64';
import starter from '../starter-prompt.risup?inline';
import { MESSAGE_BYTES, MESSAGE_PAGE, type Method, type Replies, type Request } from './protocol';
import { ImportReader } from './reader';

const u32 = (value: number, little = false) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, little);
  return [...bytes];
};

function pack(value: unknown): number[] {
  if (typeof value === 'string') {
    const bytes = strToU8(value);
    return [0xdb, ...u32(bytes.length), ...bytes];
  }
  if (Array.isArray(value)) return [0xdd, ...u32(value.length), ...value.flatMap(pack)];
  const entries = Object.entries(value as object);
  return [0xdf, ...u32(entries.length), ...entries.flatMap(([key, item]) => [...pack(key), ...pack(item)])];
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
const json = (value: unknown) => new Uint8Array(strToU8(JSON.stringify(value)));
type Message = { role: string; data: string; time: number };

function backup(messages: Message[]) {
  const characters = ['selected', 'other'].map((id) => ({
    chaId: id,
    name: id,
    image: 'assets/shared.png',
    additionalAssets: [['shared', 'assets/shared.png', 'png']],
    chats: [{ name: id, message: [{ role: 'char', data: `COLDSTORAGE${id}` }] }],
  }));
  const database = new Uint8Array([0, ...strToU8('RISUSAVE'), 0, 8, ...gzipSync(new Uint8Array(pack({ characters })))]);
  const entries: [string, Uint8Array<ArrayBuffer>][] = [
    ['database.risudat', database],
    ['shared.png', PNG],
    ['coldstorage_selected.json', json({ message: messages })],
    ['coldstorage_other.json', json({ message: [{ role: 'user', data: 'other history', time: 1 }] })],
  ];
  const spans = new Map<string, [number, number]>();
  let offset = 0;
  const parts = entries.flatMap(([name, bytes]) => {
    const header = new Uint8Array([...u32(strToU8(name).length, true), ...strToU8(name), ...u32(bytes.length, true)]);
    spans.set(name, [offset + header.length, offset + header.length + bytes.length]);
    offset += header.length + bytes.length;
    return [header, bytes];
  });
  return { file: new File(parts, 'backup.bin'), spans };
}

const ask = async <K extends Method>(reader: ImportReader, request: Request<K> & Request) => await reader.handle(request) as Replies[K];

async function selected(messages: Message[]) {
  const reader = new ImportReader();
  const result = await ask(reader, { kind: 'backup', files: [backup(messages).file] });
  if (!result.ok) throw new Error(result.failure.kind);
  await ask(reader, { kind: 'character', key: result.catalog.characters[0]!.key });
  return reader;
}

describe('ImportReader', () => {
  it('reads archive slices, selects one history, and releases histories separately from picture handles', async () => {
    const { file, spans } = backup([{ role: 'user', data: 'selected history', time: 1 }]);
    const slices = vi.spyOn(file, 'slice');
    const whole = vi.spyOn(file, 'arrayBuffer');
    const reader = new ImportReader();
    const result = await ask(reader, { kind: 'backup', files: [file] });
    if (!result.ok) throw new Error(result.failure.kind);
    expect(whole).not.toHaveBeenCalled();
    expect(result.catalog.characters.map(({ id, chatCount }) => [id, chatCount])).toEqual([['selected', 1], ['other', 1]]);
    expect(JSON.stringify(result)).not.toContain('history');

    slices.mockClear();
    const character = await ask(reader, { kind: 'character', key: result.catalog.characters[0]!.key });
    expect(slices.mock.calls).toEqual([spans.get('coldstorage_selected.json')]);
    expect(character.chatCount).toBe(1);
    expect(character).not.toHaveProperty('chats');
    expect(await ask(reader, { kind: 'chat', index: 0 })).toMatchObject({ header: { title: 'selected' }, messages: 1 });
    expect(await ask(reader, { kind: 'release' })).toBeNull();
    await expect(ask(reader, { kind: 'chat', index: 0 })).rejects.toThrow();
    expect(await ask(reader, { kind: 'picture', handle: character.avatar })).toEqual({ type: 'image/png', bytes: PNG });
    expect(await ask(reader, { kind: 'asset', handle: character.assets[0]!.handle })).toEqual(PNG);

    const other = await ask(reader, { kind: 'character', key: result.catalog.characters[1]!.key });
    expect(other.avatar).not.toBe(character.avatar);
    await expect(ask(reader, { kind: 'picture', handle: character.avatar })).rejects.toThrow();
    await expect(ask(reader, { kind: 'asset', handle: character.assets[0]!.handle })).rejects.toThrow();
    expect(await ask(reader, { kind: 'messages', index: 0, from: 0 })).toEqual({ messages: [{ role: 'user', text: 'other history', at: 1 }], next: 1 });
  });

  it('bounds message counts without losing order across pages', async () => {
    const messages = Array.from({ length: 2 * MESSAGE_PAGE + 3 }, (_, index) => ({ role: 'user', data: `message ${index}`, time: index }));
    const reader = await selected(messages);
    const header = await ask(reader, { kind: 'chat', index: 0 });
    expect(header.messages).toBe(messages.length);
    const received: RisuMessage[] = [];
    const sizes: number[] = [];
    for (let from = 0; from < header.messages; ) {
      const page = await ask(reader, { kind: 'messages', index: 0, from });
      expect(page.next).toBe(from + page.messages.length);
      sizes.push(page.messages.length);
      received.push(...page.messages);
      from = page.next;
    }
    expect(sizes).toEqual([MESSAGE_PAGE, MESSAGE_PAGE, 3]);
    expect(received).toEqual(messages.map(({ data, time }) => ({ role: 'user', text: data, at: time })));
    expect(await ask(reader, { kind: 'messages', index: 0, from: header.messages })).toEqual({ messages: [], next: header.messages });
  });

  it('budgets reasoning as well as text and advances past a single oversized message', async () => {
    const text = 'a'.repeat(MESSAGE_BYTES / 5);
    const reasoning = 'r'.repeat(MESSAGE_BYTES / 5);
    const oversized = 'x'.repeat(MESSAGE_BYTES / 2 + 1);
    const reader = await selected([
      { role: 'user', data: text, time: 1 },
      { role: 'char', data: `<Thoughts>${reasoning}</Thoughts>done`, time: 2 },
      { role: 'user', data: text, time: 3 },
      { role: 'char', data: oversized, time: 4 },
      { role: 'user', data: 'tail', time: 5 },
    ]);
    expect(await ask(reader, { kind: 'messages', index: 0, from: 0 })).toEqual({
      messages: [{ role: 'user', text, at: 1 }, { role: 'assistant', text: 'done', reasoning, at: 2 }], next: 2,
    });
    expect(await ask(reader, { kind: 'messages', index: 0, from: 2 })).toEqual({ messages: [{ role: 'user', text, at: 3 }], next: 3 });
    expect(await ask(reader, { kind: 'messages', index: 0, from: 3 })).toEqual({ messages: [{ role: 'assistant', text: oversized, at: 4 }], next: 4 });
    expect(await ask(reader, { kind: 'messages', index: 0, from: 4 })).toEqual({ messages: [{ role: 'user', text: 'tail', at: 5 }], next: 5 });
  });

  it('reads a JSON file of chats, this app\'s own or Risu\'s in either form, a Risu preset, and any other JSON as a card', async () => {
    const reader = new ImportReader();
    const read = (value: unknown) => ask(reader, { kind: 'card', file: new File([json(value)], 'file.json'), asModule: false });
    const chat = { name: '등대', message: [{ role: 'user', data: '안녕', time: 1 }, { role: 'char', data: '반가워 {{inlay::a}}', time: 2 }] };
    expect(await read({ type: 'risuChat', ver: 2, data: chat })).toMatchObject({ ok: true, risuChats: [{ title: '등대', greeting: 0, messages: [{ role: 'user', text: '안녕' }, { role: 'assistant' }] }], missed: [{ kind: 'inlay', count: 1 }] });
    expect(await read({ type: 'risuAllChats', ver: 1, data: [chat, { ...chat, name: '둘째', fmIndex: 1 }] })).toMatchObject({ ok: true, risuChats: [{ title: '등대' }, { title: '둘째', greeting: 2 }] });
    const rows = [{ id: 'c', kind: 'chat', parent: null, rev: 1, value: { title: null, character: null, models: {} } }, { id: 'e', kind: 'entry', parent: 'c', rev: 2, value: { type: 'message', role: 'user', at: 1, text: '안녕', receipt: null } }];
    expect(await read({ format: 'hazelle-chat', version: 3, character: null, rows, pictures: {} })).toMatchObject({ ok: true, chat: { chat: { id: 'c' }, entries: [{ id: 'e' }], memory: null } });
    expect(await read({ name: '핑퐁', mainPrompt: '', promptTemplate: [{ type: 'plain', text: 'hi', role: 'system' }] })).toMatchObject({ ok: true, preset: { prompt: { name: '핑퐁', blocks: [{ kind: 'text', text: 'hi' }] } } });
    expect(await read({ name: '옛날', mainPrompt: 'old' })).toEqual({ ok: false, failure: { kind: 'unreadable', detail: 'no-template' } });
    expect(await read({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Card' } })).toMatchObject({ ok: true, card: { card: { name: 'Card' } } });
  });

  it("reads Risu's HTML export of a chat from its hidden JSON, entities decoded as Risu's browser decodes them, and refuses another page", async () => {
    const reader = new ImportReader();
    const read = (html: string) => ask(reader, { kind: 'card', file: new File([html], 'Mira_chat.html'), asModule: false });
    const chat = { name: '등대', note: '', localLore: [], message: [{ role: 'char', data: '<b>Tom &amp; Jerry</b>&nbsp;끝', time: 2 }] };
    const idat = JSON.stringify(chat).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const page = `<html><body><div class="container"><div class="chat"><h2>Mira</h2><div>안녕</div></div></div><div class="idat">${idat}</div></body></html>`;
    expect(await read(page)).toMatchObject({ ok: true, risuChats: [{ title: '등대', messages: [{ role: 'assistant', text: '<b>Tom & Jerry</b> 끝' }] }] });
    expect(await read('<html><body>log</body></html>')).toEqual({ ok: false, failure: { kind: 'unreadable', detail: 'not-risu-chat' } });
  });

  it('transfers fresh buffers so repeated asset and picture reads cannot detach the CHARX archive', async () => {
    const second = new Uint8Array([...PNG, 3]);
    const archive = zipSync({
      'card.json': json({ spec: 'chara_card_v3', spec_version: '3.0', data: {
        name: 'Shared',
        assets: [
          { type: 'icon', uri: 'embeded://shared.png', name: 'main', ext: 'png' },
          { type: 'x-risu-asset', uri: 'embeded://shared.png', name: 'shared', ext: 'png' },
          { type: 'x-risu-asset', uri: 'embeded://second.png', name: 'second', ext: 'png' },
        ],
      } }),
      'shared.png': PNG,
      'second.png': second,
    }, { level: 0 });
    const reader = new ImportReader();
    const result = await ask(reader, { kind: 'card', file: new File([new Uint8Array(archive)], 'shared.charx'), asModule: false });
    if (!result.ok || !('card' in result) || result.card.avatar === null) throw new Error('card did not import');
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const [index, expected] of [PNG, second].entries()) {
        const bytes = await ask(reader, { kind: 'asset', handle: result.card.assets[index]!.handle });
        if (!bytes) throw new Error('asset missing');
        expect(structuredClone(bytes, { transfer: [bytes.buffer] })).toEqual(expected);
        expect(bytes.byteLength).toBe(0);
      }
      const picture = await ask(reader, { kind: 'picture', handle: result.card.avatar });
      if (!picture) throw new Error('picture missing');
      expect(structuredClone(picture, { transfer: [picture.bytes.buffer] })).toEqual({ type: 'image/png', bytes: PNG });
      expect(picture.bytes.byteLength).toBe(0);
    }
  });
  it("keeps a background's use across the worker", async () => {
    const archive = zipSync({
      'card.json': json({ spec: 'chara_card_v3', spec_version: '3.0', data: {
        name: 'Moods',
        assets: [{ type: 'background', uri: 'embeded://night.png', name: 'main', ext: 'png' }],
      } }),
      'night.png': PNG,
    }, { level: 0 });
    const result = await ask(new ImportReader(), { kind: 'card', file: new File([new Uint8Array(archive)], 'moods.charx'), asModule: false });
    if (!result.ok || !('card' in result)) throw new Error('card did not import');
    expect(result.card.assets.map(({ name, use }) => [name, use])).toEqual([['main', 'background']]);
  });
});

it('reads .js as a tool without evaluating it and rejects oversized files before reading bytes', async () => {
  const reader = new ImportReader();
  const file = new File(['//@api 1\n//@name notes\n//@author jin\nthrow new Error("not executed");'], 'notes.JS');
  expect(await ask(reader, { kind: 'card', file, asModule: false })).toMatchObject({ ok: true, tool: { manifest: { name: 'notes', author: 'jin' } } });
  const large = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.js');
  const whole = vi.spyOn(large, 'arrayBuffer');
  expect(await ask(reader, { kind: 'card', file: large, asModule: false })).toMatchObject({ ok: false, failure: { detail: 'tool-too-large' } });
  expect(whole).not.toHaveBeenCalled();
});

it('reads a .risum from slices of the file, never the whole of it', async () => {
  const reader = new ImportReader();
  const file = new File([risumHead({ name: '배경', assets: [['bg', '', 'png']] }), risumBlock(PNG), RISUM_END], '배경.risum');
  const whole = vi.spyOn(file, 'arrayBuffer');
  const read = await ask(reader, { kind: 'card', file, asModule: false });
  if (!read.ok || !('module' in read)) throw new Error('not a module');
  expect(await ask(reader, { kind: 'asset', handle: read.module.assets[0]!.handle })).toEqual(PNG);
  const original = await ask(reader, { kind: 'original' });
  expect(original.map(({ path }) => path)).toEqual(['risum-module', 'risum-block/0']);
  expect(await ask(reader, { kind: 'asset', handle: original[1]!.handle })).toEqual(PNG);
  expect(whole).not.toHaveBeenCalled();
});

it('reads a .risup as a preset, whatever the case of its extension, a cut .risupreset as unreadable, and a .preset as JSON', async () => {
  const reader = new ImportReader();
  const bytes = fromBase64(starter.slice(starter.indexOf(',') + 1));
  expect(await ask(reader, { kind: 'card', file: new File([bytes], 'starter.RISUP'), asModule: false })).toMatchObject({ ok: true, preset: { prompt: { name: '🏓 핑퐁 간소화' } } });
  expect(await ask(reader, { kind: 'card', file: new File([bytes.subarray(0, 100)], 'cut.risupreset'), asModule: false })).toEqual({ ok: false, failure: { kind: 'unreadable' } });
  expect(await ask(reader, { kind: 'card', file: new File([json({ name: 'p', promptTemplate: [] })], 'p.preset'), asModule: false })).toMatchObject({ ok: true, preset: { prompt: { name: 'p' } } });
});
