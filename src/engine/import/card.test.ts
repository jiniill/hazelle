import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { assetType, blankCard, imageSize, importCard, importRisum, writeCharx } from './card';
import { moduleSource } from './hazelle';
import { concat, METADATA_BYTES } from './inflate';
import { fileSource } from './source';
import { readRisum, readRisumModule, risumBlock, risumHead, RISUM_END, unpack, writeRisum } from './risum';
import type { Bot, ImportResult, Imported, Trigger, TypedModule } from './types';
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

const tEXt = (key: string, value: string) => chunk('tEXt', strToU8(`${key}\0${value}`));
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const cardText = (card: unknown) => base64(strToU8(JSON.stringify(card)));

// A 1x1 PNG; its IDAT is not a valid image, which the importer never inspects.
function png(...chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const ihdr = chunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ihdr, chunk('IDAT', new Uint8Array([1, 2, 3])), ...chunks, chunk('IEND', new Uint8Array())]);
}

const v2 = (data: Record<string, unknown>) => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Mira', description: 'd', first_mes: 'hi', ...data } });
const v3 = (data: Record<string, unknown>) => ({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Mira', description: 'd', first_mes: 'hi', ...data } });

function ok(result: ImportResult): Imported {
  if (!result.ok || !('card' in result)) throw new Error(`import failed: ${JSON.stringify(result)}`);
  return result.card;
}
// fflate's types leave the buffer open; the importer takes what a File's arrayBuffer gives.
const own = (bytes: Uint8Array) => new Uint8Array(bytes);
const json = (card: unknown) => ok(importCard('card.json', own(strToU8(JSON.stringify(card)))));
const charx = (files: Record<string, Uint8Array>) => ok(importCard('card.charx', own(zipSync(files))));
const counts = (imported: Imported) => Object.fromEntries(imported.report.unsupported.map(({ kind, count }) => [kind, count]));

// The output size the zip's directory declares for one file, rewritten in place.
function declare(zip: Uint8Array, path: string, size: number): Uint8Array<ArrayBuffer> {
  const out = own(zip);
  const view = new DataView(out.buffer);
  const name = strToU8(path);
  for (let at = 0; at + 46 <= out.length; at++) {
    if (view.getUint32(at, true) === 0x02014b50 && view.getUint16(at + 28, true) === name.length && name.every((byte, i) => out[at + 46 + i] === byte)) view.setUint32(at + 24, size, true);
  }
  return out;
}

describe('importCard', () => {
  it('prefers the ccv3 chunk over chara in a PNG', () => {
    const imported = ok(importCard('Mira.PNG', png(tEXt('chara', cardText(v2({ name: 'Old' }))), tEXt('ccv3', cardText(v3({ name: 'New' }))))));
    expect(imported.card.name).toBe('New');
    expect(imported.report).toMatchObject({ format: 'png', spec: 'v3' });
  });

  it('stores the PNG without the card chunks as the avatar', () => {
    const software = tEXt('Software', 'paint');
    const file = png(software, tEXt('chara', cardText(v2({}))), tEXt('ccv3', cardText(v3({}))), tEXt('chara-ext-asset_:1', 'AAAA'));
    expect(ok(importCard('Mira.png', file)).avatar).toEqual({ bytes: png(software), type: 'image/png' });
  });

  it('reads a Risu persona PNG, unless a card chunk is beside it, and fails one without its prompt', async () => {
    const persona = tEXt('persona', cardText({ name: '진', personaPrompt: '여행자', note: ' 부자 ' }));
    const read = importCard('jin_export.png', png(persona));
    if (!read.ok || !('persona' in read)) throw new Error(`import failed: ${JSON.stringify(read)}`);
    expect(read.persona).toMatchObject({ name: '진', alias: '부자', description: '여행자' });
    expect(await read.persona.picture()).toEqual({ bytes: png(), type: 'image/png' });
    expect(ok(importCard('Mira.png', png(persona, tEXt('ccv3', cardText(v3({})))))).card.name).toBe('Mira');
    expect(importCard('jin_export.png', png(tEXt('persona', cardText({ name: '진' }))))).toEqual({ ok: false, failure: { kind: 'unreadable', detail: 'persona-incomplete' } });
  });

  it('takes the icon named main from a charx', () => {
    const main = png(tEXt('Title', 'main'));
    const imported = charx({
      'card.json': strToU8(
        JSON.stringify(
          v3({
            assets: [
              { type: 'icon', uri: 'embeded://assets/icon/image/other.png', name: 'other', ext: 'png' },
              { type: 'icon', uri: 'embeded://assets/icon/image/main.png', name: 'main', ext: 'png' },
              { type: 'emotion', uri: 'embeded://assets/emotion/image/smile.png', name: 'smile', ext: 'png' },
            ],
          }),
        ),
      ),
      'assets/icon/image/other.png': png(tEXt('Title', 'other')),
      'assets/icon/image/main.png': main,
      'assets/emotion/image/smile.png': png(),
    });
    expect(imported.avatar).toEqual({ bytes: main, type: 'image/png' });
    expect(counts(imported)).toEqual({ 'extra-icon': 1, emotion: 1 });
  });

  it('reads a charx’s x-risu-asset files when asked, and counts the ones no file holds', async () => {
    const smile = png(tEXt('Title', 'smile'));
    const imported = charx({
      'card.json': strToU8(
        JSON.stringify(
          v3({
            assets: [
              { type: 'x-risu-asset', uri: 'embeded://assets/other/image/smile.png', name: 'Smile.png', ext: 'png' },
              { type: 'x-risu-asset', uri: 'embeded://assets/other/image/lost.png', name: 'lost', ext: 'png' },
              { type: 'x-risu-asset', uri: 'https://example.com/far.png', name: 'far', ext: 'png' },
            ],
          }),
        ),
      ),
      'assets/other/image/smile.png': smile,
    });
    expect(await Promise.all(imported.assets.map(async ({ name, read }) => [name, await read()]))).toEqual([
      ['Smile.png', smile],
      ['lost', null],
    ]);
    expect(counts(imported)).toEqual({ 'missing-asset': 1 });
  });

  it('reads a PNG’s v2 additionalAssets from its asset chunks', async () => {
    const picture = png(tEXt('Title', 'wave'));
    const file = png(tEXt('chara', cardText(v2({ extensions: { risuai: { additionalAssets: [['wave', '__asset:0', 'png']] } } }))), tEXt('chara-ext-asset_:0', base64(picture)));
    expect(await Promise.all(ok(importCard('Mira.png', file)).assets.map(async ({ name, read }) => [name, await read()]))).toEqual([['wave', picture]]);
  });

  it('reads a zip appended to a JPEG and keeps the JPEG as the avatar', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 0xff, 0xd9]);
    const imported = ok(importCard('Mira.jpeg', concat([jpeg, zipSync({ 'card.json': strToU8(JSON.stringify(v3({ name: 'Jay' }))) })])));
    expect(imported.card.name).toBe('Jay');
    expect(imported.avatar).toEqual({ bytes: jpeg, type: 'image/jpeg' });
    expect(imported.report.format).toBe('charx');
  });

  it('resolves a data: icon, as Risu writes it into a JSON export', () => {
    const image = png();
    const imported = json(v3({ assets: [{ type: 'icon', uri: `data:application/octet-stream;base64,${base64(image)}`, name: 'main', ext: 'png' }] }));
    expect(imported.avatar).toEqual({ bytes: image, type: 'image/png' });
  });

  it('falls back to Tavern v1 fields, including the char_* names', () => {
    const tavern = json({ name: 'Old', description: 'desc', personality: 'calm', scenario: 'inn', first_mes: 'hello', mes_example: '<START>' });
    expect(tavern.report.spec).toBe('v1');
    expect(tavern.card).toMatchObject({ name: 'Old', description: 'desc', personality: 'calm', scenario: 'inn', greetings: ['hello'], exampleDialogue: '<START>' });
    const pygmalion = json({ char_name: 'Py', char_persona: 'p', world_scenario: 'w', char_greeting: 'g', example_dialogue: 'e' });
    expect(pygmalion.card).toMatchObject({ name: 'Py', description: 'p', scenario: 'w', greetings: ['g'], exampleDialogue: 'e' });
  });

  it('imports a card without extensions', () => {
    const imported = json(v2({ character_version: 2 }));
    expect(imported.card).toMatchObject({ version: '2', regex: [], variables: [], toggles: [], utility: false, bias: [] });
    expect(imported.card.loreSettings).toEqual({ scanDepth: null, tokenBudget: null, recursive: null, fullWordMatching: null });
    expect(imported.lore).toEqual([]);
  });

  it('keeps greeting positions and drops only trailing empties', () => {
    expect(json(v3({ first_mes: '', alternate_greetings: ['a', '', 'b', ''] })).card.greetings).toEqual(['', 'a', '', 'b']);
  });

  it('keeps each lore setting on its own', () => {
    expect(json(v3({ character_book: { token_budget: 2000, entries: [] } })).card.loreSettings).toEqual({
      scanDepth: null,
      tokenBudget: 2000,
      recursive: null,
      fullWordMatching: null,
    });
  });

  it('honors enabled and case_sensitive and keeps CCv3 key arrays intact', () => {
    const entry = { keys: ['dragon, wyrm', '/a{1,3}/', ' '], content: 'x', enabled: false, case_sensitive: true, insertion_order: 5, priority: 3, position: 'after_char' };
    expect(json(v3({ character_book: { entries: [entry] } })).lore).toEqual([
      {
        name: '',
        keys: ['dragon, wyrm', '/a{1,3}/'],
        secondaryKeys: [],
        content: 'x',
        enabled: false,
        constant: false,
        selective: false,
        useRegex: false,
        caseSensitive: true,
        insertionOrder: 5,
        priority: 3,
        position: 'after_char',
        folder: null,
      },
    ]);
  });

  it('turns SillyTavern entry extensions into decorators in front of the content', () => {
    const extensions = { useProbability: true, probability: 30, position: 4, depth: 2, role: 1, selectiveLogic: 2, delay: 3, match_whole_words: true };
    const entry = { keys: ['k'], secondary_keys: ['x', 'y'], selective: true, content: 'body', enabled: true, insertion_order: 1, extensions };
    const [lore] = json(v3({ character_book: { entries: [entry] } })).lore;
    expect(lore).toMatchObject({
      selective: false,
      content: '@@match_full_word\n@@activate_only_after 3\n@@exclude_keys y\n@@exclude_keys x\n@@depth 2\n@@role user\n@@probability 30\nbody',
    });
  });

  it('splits defaultVariables lines at the first =', () => {
    const imported = json(v3({ extensions: { risuai: { defaultVariables: 'a=b=c\r\nhp=\n=x\nnoeq' } } }));
    expect(imported.card.variables).toEqual([
      ['a', 'b=c'],
      ['hp', ''],
    ]);
  });

  it("applies a charx's module.risum over the card", () => {
    const card = v3({
      extensions: { risuai: { customScripts: [{ comment: 'card', in: 'a', out: 'b', type: 'editoutput' }] } },
      character_book: {
        scan_depth: 7,
        token_budget: 900,
        recursive_scanning: false,
        extensions: { risu_fullWordMatching: true },
        entries: [{ keys: ['old'], content: 'old', enabled: true, insertion_order: 1 }],
      },
    });
    const imported = charx({ 'card.json': strToU8(JSON.stringify(card)), 'module.risum': Uint8Array.from(atob(RISU_MODULE.join('')), (char) => char.charCodeAt(0)) });
    expect(imported.card.regex).toEqual([{ id: 'regex-0', name: '상태창 숨김', find: '<status>[\\s\\S]*?</status>', replace: '', stage: 'display', flags: 'gi' }]);
    expect(imported.card.loreSettings).toEqual({ scanDepth: 7, tokenBudget: 900, recursive: false, fullWordMatching: true });
    expect(imported.loreFolders).toEqual(['장소']);
    expect(imported.lore).toMatchObject([
      { name: 'Castle', keys: ['성', 'castle'], caseSensitive: true, insertionOrder: 120, content: '@@probability 40\n{{char}} lives in the castle.', folder: 0 },
      { name: 'Dragon', keys: ['dragon'], content: '@@end\n<user> met a dragon.', folder: null },
    ]);
    expect(imported.card.triggers.map(({ kind }) => kind).sort()).toEqual(['blocks', 'lua']);
    expect(counts(imported)).toEqual({ 'regex-stage': 1 });
  });

  it('reads a module file as a module, with its pictures by the names its assets list gives them', async () => {
    const module = {
      name: 'Phone',
      description: 'A phone screen.',
      id: 'risu-id',
      namespace: 'phone',
      lowLevelAccess: true,
      regex: [{ comment: 'screen', in: 'a', out: 'b', type: 'editdisplay' }],
      trigger: [{ comment: 'tap', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: 'function tap() end' }] }],
      lorebook: [{ key: 'phone', comment: 'Phone', content: 'It rings.', insertorder: 10, bookVersion: 2 }],
      backgroundEmbedding: '<style>.phone { color: red }</style>',
      customModuleToggle: 'ring=Ring',
      assets: [['wall', '', 'png'], ['icon', '', 'png'], ['lost', '', 'png']],
    };
    const result = await importRisum(fileSource(new File([risum(module, [new Uint8Array([1, 2, 3]), new Uint8Array([4])])], 'Phone.risum')));
    if (!result.ok) throw new Error('not a module');
    const { assets, ...read } = result.module;
    expect(read).toEqual({
      name: 'Phone',
      description: 'A phone screen.',
      namespace: 'phone',
      risu: 'risu-id',
      pack: {
        regex: [{ id: 'regex-0', name: 'screen', find: 'a', replace: 'b', stage: 'display', flags: null }],
        triggers: [{ kind: 'lua', id: 'trigger-0', name: 'tap', code: 'function tap() end' }],
        background: '<style>.phone { color: red }</style>',
        toggles: [{ key: 'ring', label: 'Ring', kind: 'check', default: '0' }],
      },
      lore: [expect.objectContaining({ name: 'Phone', keys: ['phone'], content: 'It rings.', folder: null })],
      loreFolders: [],
      unsupported: [{ kind: 'missing-asset', count: 1 }],
    });
    expect(await Promise.all(assets.map(async ({ name, read }) => [name, [...(await read())!]]))).toEqual([['wall', [1, 2, 3]], ['icon', [4]]]);
  });

  it('reads a charx Risu exported as a module as that module, under the name a browser numbers', async () => {
    const card = v3({
      name: 'Phone',
      description: '',
      first_mes: '',
      creator_notes: 'A phone screen.',
      assets: [{ type: 'x-risu-asset', uri: 'embeded://assets/other/image/wall.png', name: 'wall', ext: 'png' }],
      extensions: { risuai: { backgroundHTML: '<style>.phone { color: red }</style>', toggles: 'ring=Ring', moduleNamespace: ' phone ' } },
    });
    const module = writeRisum({ name: 'Phone Module', description: '', regex: [{ comment: 'screen', in: 'a', out: 'b', type: 'editdisplay' }], trigger: [], lorebook: [{ key: 'phone', comment: 'Phone', content: 'It rings.', bookVersion: 2 }] });
    const result = importCard('Phone.module(2).charx', own(zipSync({ 'card.json': strToU8(JSON.stringify(card)), 'module.risum': module, 'assets/other/image/wall.png': new Uint8Array([1, 2]) })));
    if (!result.ok || !('module' in result)) throw new Error('not a module');
    const { assets, lore, ...read } = result.module;
    expect(read).toEqual({
      name: 'Phone',
      description: 'A phone screen.',
      namespace: 'phone',
      risu: null,
      pack: { regex: [{ id: 'regex-0', name: 'screen', find: 'a', replace: 'b', stage: 'display', flags: null }], triggers: [], background: '<style>.phone { color: red }</style>', toggles: [{ key: 'ring', label: 'Ring', kind: 'check', default: '0' }] },
      loreFolders: [],
      unsupported: [],
    });
    expect(lore).toMatchObject([{ name: 'Phone', keys: ['phone'], content: 'It rings.' }]);
    expect(await Promise.all(assets.map(async ({ name, read }) => [name, [...(await read())!]]))).toEqual([['wall', [1, 2]]]);
  });

  it("brings back as lore what Risu's module export moved into the card's description, greetings and global note", () => {
    const card = v3({ name: 'Realm', description: 'The realm.', first_mes: 'Hello.', alternate_greetings: ['Hi.'], post_history_instructions: 'Stay terse.' });
    const module = writeRisum({ name: 'Realm', lorebook: [{ key: 'gate', comment: 'Gate', content: 'A gate.', bookVersion: 2 }] });
    const result = importCard('Realm.module.charx', own(zipSync({ 'card.json': strToU8(JSON.stringify(card)), 'module.risum': module })));
    if (!result.ok || !('module' in result)) throw new Error('not a module');
    const entry = { keys: [], secondaryKeys: [], enabled: true, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 0, priority: null, position: null, folder: null };
    expect(result.module.lore.slice(1)).toEqual([
      { ...entry, name: 'From Character Description', content: '@@indicator character_desc\n\nThe realm.', constant: true },
      { ...entry, name: 'From First Messages', content: '@@indicator character_first_message\n\n<FM>\nHello.\n</FM>\n<FM_alt>\nHi.\n</FM_alt>', constant: false },
      { ...entry, name: 'From Global Note Replacement', content: '@@indicator replace_global_note\n\nStay terse.', constant: true },
    ]);
    expect(result.module.lore[0]).toMatchObject({ name: 'Gate' });
  });

  it('reads any charx as a module when it comes in on the module list, and as a character elsewhere', () => {
    const bytes = () => own(zipSync({ 'card.json': strToU8(JSON.stringify(v3({ name: 'Phone', creator_notes: 'A phone screen.' }))) }));
    expect(importCard('Phone.charx', bytes(), true)).toMatchObject({ ok: true, module: { name: 'Phone', description: 'A phone screen.' } });
    expect(importCard('Phone.charx', bytes())).toMatchObject({ ok: true, card: { card: { name: 'Phone' } } });
  });

  it("reads Risu's lorebook and regex exports and SillyTavern's world info as modules made of them", () => {
    const read = (fileName: string, value: unknown) => {
      const result = importCard(fileName, own(strToU8(JSON.stringify(value))));
      if (!result.ok || !('module' in result)) throw new Error('not a module');
      return result.module;
    };
    expect(read('lorebook_export.json', { type: 'risu', ver: 1, data: [{ key: 'gate, door', comment: 'Gate', content: 'A gate.', mode: 'normal', insertorder: 5, bookVersion: 2 }] })).toMatchObject({
      name: '',
      lore: [{ name: 'Gate', keys: ['gate', 'door'], content: 'A gate.', insertionOrder: 5 }],
    });
    expect(read('regexscript_export.json', { type: 'regex', data: [{ comment: 'trim', in: 'a', out: 'b', type: 'editoutput' }] }).pack.regex).toMatchObject([{ name: 'trim', find: 'a', replace: 'b' }]);
    const world = { entries: { 0: { uid: 0, key: ['gate'], keysecondary: ['night'], comment: 'Gate', content: 'A gate.', constant: true, selective: true, order: 7 } } };
    expect(read('World.json', world).lore).toMatchObject([{ name: 'Gate', keys: ['gate'], secondaryKeys: ['night'], content: 'A gate.', constant: true, selective: true, insertionOrder: 7 }]);
  });

  it('imports the card alone when module.risum is unreadable', () => {
    const card = v3({ extensions: { risuai: { customScripts: [{ comment: 'card', in: 'a', out: 'b', type: 'editoutput', ableFlag: false, flag: 'i' }] } } });
    const imported = charx({ 'card.json': strToU8(JSON.stringify(card)), 'module.risum': new Uint8Array([111, 0, 255, 255, 255, 255]) });
    expect(imported.card.regex).toEqual([{ id: 'regex-0', name: 'card', find: 'a', replace: 'b', stage: 'output', flags: null }]);
    expect(counts(imported)).toEqual({ module: 1 });
  });

  it('counts what it cannot run, keeps the triggers that do something, and leaves the text as it was', () => {
    const imported = json(
      v3({
        description: '{{emotion::x}} {{getvar::y}} {{ JB_Toggled }}',
        assets: [
          { type: 'icon', uri: 'ccdefault:', name: 'main', ext: 'png' },
          { type: 'emotion', uri: 'data:image/png;base64,AAAA', name: 'smile', ext: 'png' },
        ],
        extensions: {
          depth_prompt: { depth: 4, prompt: 'stay in character' },
          risuai: {
            backgroundHTML: '<div>{{getvar::hp}}</div>',
            additionalText: 'extra',
            prebuiltAssetCommand: true,
            largePortrait: true,
            viewScreen: 'imggen',
            onboarding: { enabled: true },
            inlayViewScreen: true,
            toggles: 'sims=시뮬레이터 모드\n모드 고르기',
            lowLevelAccess: true,
            triggerscript: [
              { comment: 'hp', type: 'start', effect: [{ type: 'triggerlua', code: 'setChatVar("hp", "1")' }] },
              { comment: 'set', type: 'manual', conditions: [], effect: [{ type: 'setvar' }] },
              { effect: [{ type: 'triggerlua', code: ' ' }] },
              { effect: [{ type: 'v2Header' }, { type: 'v2EndIndent' }] },
            ],
            customScripts: [
              { comment: 't', in: 'a', out: 'b', type: 'edittrans' },
              { comment: 'off', in: 'a', out: 'b', type: 'disabled' },
            ],
          },
        },
        character_book: { entries: [{ keys: ['k'], content: '@@disable_ui_prompt x\n@@depth 1\nbody {{bgm::a}}', enabled: true, insertion_order: 1 }] },
      }),
    );
    expect(imported.card.description).toBe('{{emotion::x}} {{getvar::y}} {{ JB_Toggled }}');
    expect(imported.avatar).toBeNull();
    expect(imported.card.triggers).toEqual([
      { kind: 'lua', id: 'trigger-0', name: 'hp', code: 'setChatVar("hp", "1")' },
      { kind: 'blocks', id: 'trigger-1', name: 'set', on: 'manual', conditions: [], effects: [{ kind: 'set', name: '', operator: null, value: { kind: 'text', text: '' } }] },
    ]);
    expect(imported.report.unsupported).toEqual([
      { kind: 'emotion', count: 1 },
      { kind: 'background-html', count: 1 },
      { kind: 'additional-text', count: 1 },
      { kind: 'prebuilt-asset-command', count: 1 },
      { kind: 'large-portrait', count: 1 },
      { kind: 'view-screen', count: 1 },
      { kind: 'depth-prompt', count: 1 },
      { kind: 'disable-ui-prompt', count: 1 },
      { kind: 'cbs-tag', count: 3 },
      { kind: 'regex-stage', count: 1 },
      { kind: 'regex-off', count: 1 },
      { kind: 'toggle-line', count: 1 },
      { kind: 'onboarding', count: 1 },
    ]);
  });

  it('writes a module.risum byte for byte as Risu wrote the real one, and reads back what it wrote', () => {
    const real = Uint8Array.from(atob(RISU_MODULE.join('')), (char) => char.charCodeAt(0));
    expect(writeRisum(readRisumModule(real)!)).toEqual(real);
    const module = { name: '전화', regex: [{ comment: '화면', in: '\u0000a', out: '💬', type: 'editdisplay' }] };
    expect(readRisumModule(writeRisum(module))).toEqual(module);
  });

  it('writes a .risum’s pictures as blocks that read back byte for byte, one per listed asset', async () => {
    const pictures = [Uint8Array.from({ length: 256 }, (_, byte) => byte), new Uint8Array([137, 80, 78, 71])];
    const module = { name: '배경', assets: pictures.map((_, place) => [`bg${place}`, '', 'png']) };
    const read = (await readRisum(fileSource(new File([risumHead(module), ...pictures.map(risumBlock), RISUM_END], '배경.risum'))))!;
    expect(read.module).toEqual(module);
    expect(await Promise.all(read.assets.map((block) => block()))).toEqual(pictures);
  });

  it('writes lowLevelAccess exactly when Risu’s own list holds a Lua trigger, for a module and for a charx', () => {
    const lua = (off?: true) => ({ id: 'trigger-0', kind: 'lua' as const, name: 'main', code: 'return 1', ...(off && { off }) });
    const module = (triggers: Trigger[]): TypedModule => ({
      risu: 'm', name: '전화', description: '', namespace: null, likeness: null, lore: [], loreFolders: [], assets: [], pack: { regex: [], triggers, toggles: [] },
    });
    expect(moduleSource(module([lua()])).lowLevelAccess).toBe(true);
    expect(moduleSource(module([lua(true)]))).not.toHaveProperty('lowLevelAccess');
    const bot = (bundled: TypedModule[]): Bot => ({ card: blankCard('루나'), lore: [], loreFolders: [], avatar: null, assets: [], own: { character: {}, likeness: null }, bundled });
    const risuai = (written: Bot) => JSON.parse(new TextDecoder().decode(writeCharx(written).files[0]!.bytes)).data.extensions.risuai;
    expect(risuai(bot([]))).not.toHaveProperty('lowLevelAccess');
    expect(risuai(bot([module([lua()])])).lowLevelAccess).toBe(true);
  });

  it('refuses a file past a size limit by what it declares, before unpacking or reading it', async () => {
    const file = zipSync({ 'card.json': strToU8(JSON.stringify(v3({}))), 'assets/other/image/0.png': new Uint8Array(1000) });
    const refused = (detail: string) => ({ ok: false, failure: { kind: 'unreadable', detail } });
    expect(importCard('Mira.charx', declare(file, 'assets/other/image/0.png', 0xffffffff))).toEqual(refused('expands-too-far'));
    expect(importCard('Mira.charx', declare(file, 'card.json', METADATA_BYTES + 1))).toEqual(refused('entry-too-large'));
    const head = new Uint8Array(6);
    head.set([111, 0]);
    new DataView(head.buffer).setUint32(2, METADATA_BYTES + 1, true);
    expect(await importRisum({ size: 2 * METADATA_BYTES, read: async () => head })).toEqual(refused('entry-too-large'));
  });

  it('fails by kind instead of throwing', async () => {
    expect(importCard('Mira.png', png(tEXt('chara', 'rcc||rccv1||abc||def||ghi')))).toEqual({ ok: false, failure: { kind: 'encrypted' } });
    expect(importCard('Mira.webp', new Uint8Array())).toEqual({ ok: false, failure: { kind: 'unknown-format' } });
    expect(await importRisum(fileSource(new File([new Uint8Array([111, 0])], 'Mira.risum')))).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
    expect(importCard('Mira.png', own(strToU8('not a png')))).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
    expect(importCard('Mira.json', own(strToU8('{')))).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
    expect(importCard('Mira.charx', own(strToU8('PK')))).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
  });
});

describe('assetType', () => {
  it('keeps pictures, MP4 and WebM video, and nothing else, audio in an MP4 or Matroska included', () => {
    const header = (...parts: (string | number[])[]) => new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...strToU8(part)] : part)));
    const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84];
    expect([
      header([137], 'PNG\r\n\x1a\n'),
      header([0, 0, 0, 32], 'ftypisom'),
      header([0, 0, 0, 32], 'ftypavif'),
      header([0, 0, 0, 32], 'ftypM4A '),
      header(ebml, 'webm'),
      header(ebml, 'matroska'),
      header('ID3'),
    ].map(assetType)).toEqual(['image/png', 'video/mp4', 'image/avif', null, 'video/webm', null, null]);
  });
});

// A module file as Risu's exportModuleLegacy writes it, encoded with the inverse of the decode table.
function risum(module: unknown, assets: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const encode = new Uint8Array(256);
  unpack(Uint8Array.from({ length: 256 }, (_, byte) => byte)).forEach((plain, packed) => (encode[plain] = packed));
  const block = (bytes: Uint8Array) => concat([new Uint8Array(new Uint32Array([bytes.length]).buffer), bytes.map((byte) => encode[byte]!)]);
  return concat([new Uint8Array([111, 0]), block(strToU8(JSON.stringify({ type: 'risuModule', module }))), ...assets.flatMap((asset) => [new Uint8Array([1]), block(asset)]), new Uint8Array([0])]);
}

// A module.risum laid out as Risu's exportModuleLegacy writes it and encoded with the encode half of the real
// rpack_map.bin (RisuAI ca1345fc), so it checks the ported decode table against Risu's own bytes.
const RISU_MODULE = [
  'bwDfBwAA5m5hYSAtQOKyTAUgl2HmbmFhYWEg8tMtBSCXYSChNUqhRmdh20DiskwFIABuYWFhYSDiBUg8eQ4sDw5A8iCXYSDbQOKy',
  'TAVhjkB5YaE1SqFGZyAAbmFhYWEgDuIgl2Eg0h2RPFaO0gUMkdNkggwWPGRkDHSOFhYMVuLSPBaOgo7B08HSIABuYWFhYSAPeQ4q',
  'KgV5IJdh9G5hYWFhYWHmbmFhYWFhYWFhIDxALS0F8g8gl2EgIABuYWFhYWFhYWEgD2wsBSCXYSBID9N5DyAAbmFhYWFhYWFhIDxA',
  '8uIODw5A8kggl2H0zwBuYWFhYWFhYWEgBY6OBTwPIJdh9G5hYWFhYWFhYWFh5m5hYWFhYWFhYWFhYWEgD2wsBSCXYSAPeQ4qKgV5',
  'TLLTIABuYWFhYWFhYWFhYWFhIDxA4gUgl2EgjrLyPA8OQPJhQPJLD9N5D22rYQXy4iBuYWFhYWFhYWFhYXtuYWFhYWFhYWHPAG5h',
  'YWFhYWFhYSBMQLVJBXoFTLQ8PAVISCCXYY7TTEgFbmFhYWFhYXsAbmFhYWFhYeZuYWFhYWFhYWEgPEAtLQXyDyCXYSBXLCAAbmFh',
  'YWFhYWFhIA9sLAUgl2EgQLIPLLIPIABuYWFhYWFhYWEgPEDy4g4PDkDySCCXYfTPAG5hYWFhYWFhYSAFjo4FPA8gl2H0bmFhYWFh',
  'YWFhYWHmbmFhYWFhYWFhYWFhYSAPbCwFIJdhIEgFD3rTeSAAbmFhYWFhYWFhYWFhYSBALAV50w9AeSCXYSDWIABuYWFhYWFhYWFh',
  'YWFhIHrTeSCXYSBXLCAAbmFhYWFhYWFhYWFhYSB600yyBSCXYSDB0iBuYWFhYWFhYWFhYXtuYWFhYWFhYWHPbmFhYWFhYXtuYWFh',
  'Yc8AbmFhYWEgeQUqBacgl2H0bmFhYWFhYeZuYWFhYWFhYWEgPEAtLQXyDyCXYSATmof3miETntRhE+tEWfP+IABuYWFhYWFhYWEg',
  'DvIgl2EgI0gP0w+ySFL0FRVIFRVLz8nRI69ID9MPskhSIABuYWFhYWFhYWEgQLIPIJdhICAAbmFhYWFhYWFhIA9sLAUgl2EgBeIO',
  'D+IOSCxM02wgAG5hYWFhYWFhYSDTHUwFWEzTKiCXYQ95sgUAbmFhYWFhYWFhII5M0yogl2EgKg4gbmFhYWFhYXsAbmFhYWFhYeZu',
  'YWFhYWFhYWEgPEAtLQXyDyCXYSAPedPySEzTDwUgAG5hYWFhYWFhYSAO8iCXYSDTIABuYWFhYWFhYWEgQLIPIJdhIB0gAG5hYWFh',
  'YWFhYSAPbCwFIJdhIAXiDg8PedPySCAAbmFhYWFhYWFhINMdTAVYTNMqIJdhjtNMSAVuYWFhYWFhe25hYWFhzwBuYWFhYSBMQHkF',
  'HUBAzSCXYfRuYWFhYWFh5m5hYWFhYWFhYSDNBWwgl2Egff7+jkBM4gV5lxbiwTwgAG5hYWFhYWFhYSA8QC0tBfIPIJdhIBMf7hMz',
  '3SAAbmFhYWFhYWFhIDxA8g8F8g8gl2EgIABuYWFhYWFhYWEgLUDiBSCXYSCOQEziBXkgAG5hYWFhYWFhYSAO8kgFeQ9AeeIFeSCX',
  'YcHS0gBuYWFhYWFhYWEg00y102xItDwPDnoFIJdhjtNMSAUAbmFhYWFhYWFhIEgFPEDy4s0FbCCXYSAgAG5hYWFhYWFhYSBIBUwF',
  'PA8OegUgl2GO00xIBW5hYWFhYWF7AG5hYWFhYWHmbmFhYWFhYWFhIM0FbCCXYSATAmkAYTzTSA9MBSAAbmFhYWFhYWFhIEgFPEDy',
  '4s0FbCCXYSAgAG5hYWFhYWFhYSAO8kgFeQ9AeeIFeSCXYcFW0gBuYWFhYWFhYWEgPEAtLQXyDyCXYSDo00gPTAUgAG5hYWFhYWFh',
  'YSA8QPIPBfIPIJdhICM8V9N5UmFMDnoFSGEO8mEPVwVhPNNID0wFXSAAbmFhYWFhYWFhIC1A4gUgl2Eg8kB5LdNMIABuYWFhYWFh',
  'YWEg00y102xItDwPDnoFIJdhjtNMSAUAbmFhYWFhYWFhIEgFTAU8Dw56BSCXYY7TTEgFAG5hYWFhYWFhYSAFpw8F8g8OQPJIIJdh',
  '5m5hYWFhYWFhYWFhIHkOSLI0PNNIBTRIBfJIDg8OegUgl2EPebIFbmFhYWFhYWFhewBuYWFhYWFhYWEg0zwPDnrTDw5A8jsFeTwF',
  '8g8gl2EW0gBuYWFhYWFhYWEgjkBM4gV5IJdhIH3+/o5ATOIFeZcW4sE8IG5hYWFhYWF7AG5hYWFhYWHmbmFhYWFhYWFhIM0FbCCX',
  'YSDiedMqQPIgAG5hYWFhYWFhYSBIBTxA8uLNBWwgl2EgIABuYWFhYWFhYWEgDvJIBXkPQHniBXkgl2HB0tIAbmFhYWFhYWFhIDxA',
  'LS0F8g8gl2EgL3nTKkDyIABuYWFhYWFhYWEgPEDyDwXyDyCXYSD//wXy4hXyI7JIBXlSYS0FD2HTYeJ50ypA8l0gAG5hYWFhYWFh',
  'YSAtQOIFIJdhIPJAeS3TTCAAbmFhYWFhYWFhINNMtdNsSLQ8Dw56BSCXYY7TTEgFAG5hYWFhYWFhYSBIBUwFPA8OegUgl2GO00xI',
  'BQBuYWFhYWFhYWEgHUBAzUcFeUgOQPIgl2FWbmFhYWFhYXtuYWFhYc9uYWF7AG5hYSAPbCwFIJdhIHkOSLLbQOKyTAUgbnsA',
];

it('reads a picture\'s size from its header, past a JPEG\'s tables, and none from a header cut short', () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));
  expect(imageSize(png)).toEqual({ type: 'image/png', width: 1, height: 1 });
  const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc4, 0x00, 0x02, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x00, 0x30, 0x00, 0x40, 0x03);
  expect(imageSize(jpeg)).toEqual({ type: 'image/jpeg', width: 64, height: 48 });
  expect(imageSize(png.subarray(0, 18))).toBeNull();
});
