import { Unzip, UnzipInflate } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { list } from '../connectors/values';
import { blockConditions, blockEffects } from '../engine/import/blocks';
import { blankCard, importCard, importRisum } from '../engine/import/card';
import { readRisum, readRisumModule } from '../engine/import/risum';
import { fileSource } from '../engine/import/source';
import { PLAIN_LUA, type Card, type LoreEntry } from '../engine/import/types';
import { likenessId } from '../model/likeness';
import { setService } from './admin';
import { readTool } from '../engine/import/tool';
import { toolId } from '../model/tool';
import { exportCharacter, exportModule, importCardFile, type ExportStep } from './card-file';
import { importCharacter } from './characters';
import { importModule, setCharacterModule } from './modules';
import type { ObjectStore } from './store';
import type { Files } from './files';
import { png, testServer } from './testing';

const server = testServer();
vi.mock('./picture', () => ({ thumbnail: vi.fn(async () => 'data:thumb') }));

const entry = (name: string, over: Partial<LoreEntry> = {}): LoreEntry => ({
  name, keys: [name], secondaryKeys: [], content: `<user> meets ${name}.\n@@end`, enabled: true, constant: false, selective: false, useRegex: false,
  caseSensitive: false, insertionOrder: 100, priority: null, position: null, folder: null, ...over,
});
const portraits = { portraits: [{ name: '루나', aliases: ['Luna'], look: 'silver hair', outfits: [{ name: '교복', tags: 'school uniform' }], artist: 'ask', source: 'text' as const }], at: 5 };

// Everything one character holds, as the store gives it back, with its lore's and pictures' folders and files by name.
async function held(store: ObjectStore, files: Files, id: string) {
  const { card, loreFolders, ...character } = store.get('character', id)!.value;
  const folder = (folderId: string | null) => loreFolders.find((each) => each.id === folderId)?.name ?? null;
  const pictures = await Promise.all(store.children('asset', id).map(async ({ value }) => [value.name, await files.read(value.file)]));
  const avatar = store.children('avatar', id)[0];
  return {
    card,
    character,
    loreFolders: loreFolders.map(({ name }) => name),
    lore: store.children('lore', id).map(({ value }) => ({ ...value, folder: folder(value.folder) })),
    pictures,
    avatar: avatar && (await files.read(avatar.value.file)),
    likeness: store.get('likeness', likenessId(id))?.value,
  };
}

async function heldModule(store: ObjectStore, files: Files, id: string) {
  const { loreFolders, ...module } = store.get('module', id)!.value;
  const folder = (folderId: string | null) => loreFolders.find((each) => each.id === folderId)?.name ?? null;
  return {
    ...module,
    loreFolders: loreFolders.map(({ name }) => name),
    lore: store.children('lore', id).map(({ value }) => ({ ...value, folder: folder(value.folder) })),
    pictures: await Promise.all(store.children('asset', id).map(async ({ value }) => [value.name, await files.read(value.file)])),
    likeness: store.get('likeness', likenessId(id))?.value,
  };
}

describe('a character file', () => {
  it('gives back through its charx all the character holds, and its module turned on, in another account and again', async () => {
    // The first account is the operator, who opens a second seat.
    const { store, files } = await server.operator();
    await setService({ signupCap: 2, accountBytesCap: null, accountFileBytesCap: null });
    const card: Card = {
      ...blankCard('루나'),
      description: 'A lighthouse keeper.',
      greetings: ['안녕', '', '또 왔네'],
      tags: ['바다'],
      variables: [['hp', '10']],
      bias: [['luna', 5]],
      background: '<style>.luna { color: red }</style>',
      toggles: [{ key: 'mood', label: '기분', kind: 'check', default: '0' }],
      loreSettings: { scanDepth: 4, tokenBudget: null, recursive: true, fullWordMatching: null },
      regex: [
        { id: 'regex-0', name: '상태창', find: '<s>(.*)</s>', replace: '$1', stage: 'display', flags: 'gs' },
        { id: 'regex-1', name: '꺼 둔 것', find: 'a', replace: 'b', stage: 'output', flags: null, off: true },
      ],
      triggers: [
        { id: 'trigger-0', kind: 'lua', ...PLAIN_LUA, name: 'main', code: 'function onOutput() end' },
        {
          id: 'trigger-1',
          kind: 'blocks',
          name: 'heal',
          on: 'output',
          conditions: blockConditions([{ type: 'var', var: 'hp', operator: '>', value: '0' }, { type: 'exists', value: 'x', depth: 3, type2: 'loose' }]),
          effects: blockEffects([
            { type: 'v2Header', indent: 0 },
            { type: 'v2IfAdvanced', source: 'hp', sourceType: 'var', condition: '<', target: '10', targetType: 'value', indent: 0 },
            { type: 'v2SetVar', var: 'hp', operator: '+=', value: '5', valueType: 'value', indent: 1 },
            { type: 'v2EndIndent', indent: 1 },
            { type: 'v2Else', indent: 0 },
            { type: 'v2LoopNTimes', value: '3', valueType: 'value', indent: 1 },
            { type: 'v2BreakLoop', indent: 2 },
            { type: 'v2EndIndent', indent: 2, endOfLoop: true },
            { type: 'v2EndIndent', indent: 1 },
            { type: 'v2GetDictVar', var: 'bag', key: 'gold', keyType: 'value', outputVar: 'gold', indent: 0 },
            { type: 'v2Unknown', anything: [1], indent: 0 },
          ]),
        },
        { id: 'trigger-2', kind: 'lua', ...PLAIN_LUA, name: 'spare', code: 'return 1', off: true },
      ],
    };
    const lore = [entry('등대', { folder: 1 }), entry('꺼진', { enabled: false }), entry('앞', { priority: 3, position: 'before_char', keys: ['a, b', 'c'] }), entry('바다', { folder: 0, constant: true })];
    const [face, shell] = [png(), png()];
    const own = { character: { translatorNote: '존댓말', keepThoughts: true as const, statusScripts: ['regex-0'], translations: [{ source: '안녕', language: 'English', translation: { text: 'Hi', receipt: null, at: 7 } }] }, likeness: portraits };
    const made = await importCharacter(store, files, { card, lore, loreFolders: ['마을', '바다'], assets: [{ name: 'shell', read: async () => shell }], own }, { bytes: face, type: 'image/png' }, () => {});
    const id = made.ok ? made.data.id : '';
    const wall = png();
    const module = await importModule(store, files, {
      name: '전화', description: '폰 화면', namespace: 'phone', risu: null, unsupported: [], likeness: portraits,
      pack: { regex: [{ id: 'regex-0', name: '화면', find: 'x', replace: 'y', stage: 'input', flags: null }], triggers: [], background: '<style>.phone {}</style>', toggles: [{ key: 'ring', label: '벨', kind: 'check', default: '0' }] },
      lore: [entry('벨', { folder: 0 })], loreFolders: ['기기'], assets: [{ name: 'wall', read: async () => wall }],
    }, () => {});
    const moduleId = module.ok ? module.data.id : '';
    await setCharacterModule(store, id, moduleId, true);

    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const output = { write: async (chunk: Uint8Array<ArrayBuffer>) => void chunks.push(chunk), close: async () => {}, abort: async () => {} };
    const steps: ExportStep[] = [];
    expect(await exportCharacter(store, files, id, output, (step) => steps.push(step))).toEqual({ ok: true, data: { tools: 0 } });
    expect(steps.at(-1)).toEqual({ done: steps[0]!.total, total: steps[0]!.total });
    const file = new Uint8Array(await new Blob(chunks).arrayBuffer());
    // As RisuAI's CharXImporter reads it: fflate's streaming Unzip, fed in chunks, every file whole.
    const unzipped = new Map<string, Uint8Array>();
    const unzip = new Unzip((entry) => {
      const parts: number[] = [];
      entry.ondata = (error, data, final) => {
        parts.push(...data);
        if (final) unzipped.set(entry.name, Uint8Array.from(parts));
      };
      entry.start();
    });
    unzip.register(UnzipInflate);
    for (let at = 0; at < file.length; at += 7) unzip.push(file.subarray(at, at + 7), at + 7 >= file.length);
    const cardJson = JSON.parse(new TextDecoder().decode(unzipped.get('card.json')));
    expect(cardJson.spec).toBe('chara_card_v3');
    expect(cardJson.data.extensions.risuai.lowLevelAccess).toBe(true);
    expect(cardJson.data.assets.map(({ uri }: { uri: string }) => unzipped.get(uri.slice('embeded://'.length)))).toEqual([face, shell, wall]);
    // Its scripts and lorebook, the module's after the character's, without those turned off: 3 folders and 4 entries.
    const risum = readRisumModule(unzipped.get('module.risum')!)!;
    expect([list(risum.regex).length, list(risum.trigger).length, list(risum.lorebook).length]).toEqual([2, 2, 7]);

    const read = await importCard('루나.charx', file);
    if (!read.ok || !('card' in read)) throw new Error('not a card');
    expect(read.card.report.unsupported).toEqual([]);

    const before = await held(store, files, id);
    const moduleBefore = await heldModule(store, files, moduleId);

    // The page now holds the other account, as after signing in to it.
    const other = await server.account('other');
    const brought = await importCardFile(other.store, other.files, read.card, () => {});
    const copy = brought.ok ? brought.data.id : '';
    const after = await held(other.store, other.files, copy);
    const onAfter = after.character.modules!;
    expect({ ...after, character: { ...after.character, modules: [] } }).toEqual({ ...before, character: { ...before.character, modules: [], changed: expect.any(Number) } });
    const { risu, ...moduleAfter } = await heldModule(other.store, other.files, onAfter[0]!);
    expect(risu).toBe(moduleId);
    expect(moduleAfter).toEqual(moduleBefore);

    const again = await importCardFile(other.store, other.files, read.card, () => {});
    expect(again.ok && other.store.get('character', again.data.id)!.value.modules).toEqual(onAfter);
    expect(other.store.list('module')).toHaveLength(1);
  });
});

describe('a module file', () => {
  it('gives back through its .risum all the module holds but its tool, with its pictures as stored', async () => {
    const { store, files } = await server.operator();
    await setService({ signupCap: 2, accountBytesCap: null, accountFileBytesCap: null });
    const pictures = [png(), png()];
    const made = await importModule(store, files, {
      name: '전화', description: '폰 화면', namespace: 'phone', risu: null, unsupported: [],
      pack: {
        regex: [{ id: 'regex-0', name: '화면', find: 'x', replace: 'y', stage: 'display', flags: null }, { id: 'regex-1', name: '꺼 둔 것', find: 'a', replace: 'b', stage: 'output', flags: null, off: true }],
        triggers: [{ id: 'trigger-0', kind: 'lua', ...PLAIN_LUA, name: 'main', code: 'function onOutput() end' }, { id: 'trigger-1', kind: 'lua', ...PLAIN_LUA, name: 'spare', code: 'return 1', off: true }],
        background: '<style>.phone {}</style>',
        toggles: [{ key: 'ring', label: '벨', kind: 'check', default: '0' }],
      },
      lore: [entry('벨', { folder: 0 }), entry('꺼진', { enabled: false, folder: 0 }), entry('앞', { priority: 3, position: 'before_char', keys: ['a, b', 'c'] }), entry('늘', { constant: true })],
      loreFolders: ['기기'],
      assets: pictures.map((bytes, place) => ({ name: `wall${place}`, read: async () => bytes })),
    }, () => {});
    const id = made.ok ? made.data.id : '';
    const tool = readTool(new TextEncoder().encode('//@api 1\n//@name dial\n//@author jin'));
    if (!tool.ok) throw new Error('fixture');
    const saved = await files.save([tool.tool.bytes]);
    if (!saved.ok) throw new Error(saved.error);
    await store.batch([{ type: 'create', kind: 'tool', id: toolId(id), parent: id, value: { manifest: tool.tool.manifest, file: saved.data[0]!, size: tool.tool.bytes.byteLength, settings: {} } }]);

    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const output = { write: async (chunk: Uint8Array<ArrayBuffer>) => void chunks.push(chunk), close: async () => {}, abort: async () => {} };
    expect(await exportModule(store, files, id, output, () => {})).toEqual({ ok: true, data: { tools: 1 } });
    const file = new File(chunks, '전화.risum');
    const risum = (await readRisum(fileSource(file)))!;
    expect(await Promise.all(risum.assets.map((block) => block()))).toEqual(pictures);
    expect(list(risum.module.assets)).toHaveLength(pictures.length);
    expect(risum.module).toMatchObject({ id, namespace: 'phone', lowLevelAccess: true });
    // Risu's own lists hold what is on: one script, one trigger, the folder and the three entries it reads.
    expect([list(risum.module.regex).length, list(risum.module.trigger).length, list(risum.module.lorebook).length]).toEqual([1, 1, 4]);

    const read = await importRisum(fileSource(file));
    if (!read.ok) throw new Error('not a module');
    expect(read.module.unsupported).toEqual([]);
    const other = await server.account('other');
    const brought = await importModule(other.store, other.files, read.module, () => {});
    const before = await heldModule(store, files, id);
    expect(await heldModule(other.store, other.files, brought.ok ? brought.data.id : '')).toEqual(before);
  });
});
