import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { importCard } from '../engine/import/card';
import { importPreset } from '../engine/import/preset';
import { originalParts } from '../engine/import/original';
import { PLAIN_LUA, type Card, type Trigger } from '../engine/import/types';
import { without } from '../model/fields';
import { accountSettings, changeSettings } from './account-settings';
import { importCharacter } from './characters';
import { ImportReader } from './import/reader';
import type { Down, Up } from './import/protocol';
import { keepOriginal } from './originals';
import { savePreset } from './prompts';
import { rereadOriginals } from './reread';
import type { ObjectStore } from './store';
import { png, testServer } from './testing';

const server = testServer();
vi.mock('./picture', () => ({ thumbnail: vi.fn(async () => 'data:thumb') }));
vi.mock('./import/worker?worker&url', () => ({ default: '/import-worker.js' }));

// The import worker, run in this thread by the reader it runs, beside the harness's own (testing/object-codec-setup).
const Harness = globalThis.Worker;
const workers = function (url: string) {
  return url === '/import-worker.js' ? new InThread() : new Harness(url);
};
class InThread {
  onmessage: ((event: MessageEvent<Up>) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  private readonly reader = new ImportReader();
  postMessage(down: Down) {
    if ('ping' in down) return;
    void this.reader.handle(down.request).then((result) => this.onmessage?.({ data: { id: down.id, result } } as MessageEvent<Up>));
  }
  terminate() {}
}

const condition = { type: 'var', var: 'hp', operator: '>', value: '0' };
const later = { type: 'v2SetVar', var: 'seen', operator: '=', value: '1', valueType: 'value', indent: 0 };
const lua = (comment: string, code: string) => ({ comment, type: 'output', conditions: [condition], effect: [{ type: 'triggerlua', code }, later] });
const [smile, backdrop] = [png(), png()];
const card = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Mira', description: 'd', first_mes: 'hi',
    assets: [
      { type: 'x-risu-asset', name: 'smile', uri: 'embeded://assets/other/smile.png', ext: 'png' },
      { type: 'background', name: 'night', uri: 'embeded://assets/background/night.png', ext: 'png' },
    ],
    extensions: { risuai: {
      additionalText: 'later',
      onboarding: { enabled: true, title: 'ask' },
      customScripts: [{ comment: 'tr', in: 'a', out: 'b', type: 'edittrans' }],
      triggerscript: [lua('main', 'main()'), lua('kept', 'kept()')],
    } },
  },
};
const charx = new Uint8Array(zipSync({ 'card.json': strToU8(JSON.stringify(card)), 'assets/other/smile.png': smile, 'assets/background/night.png': backdrop }));

// What the import made of it before 2026-11-09, upgraded as upgrade.ts does: no background, text, survey or
// translation script, its Lua triggers' code alone. The second trigger the user has edited since.
function asOld(read: Card): Card {
  const plain = (trigger: Trigger): Trigger => (trigger.kind === 'lua' ? { id: trigger.id, kind: 'lua', name: trigger.name, code: trigger.code, ...PLAIN_LUA } : trigger);
  const [main, kept] = read.triggers.map(plain);
  return { ...without(read, 'onboarding'), additionalText: '', regex: [], triggers: [main!, { ...kept!, code: 'mine()' } as Trigger] };
}

async function kept(store: ObjectStore, files: Parameters<typeof keepOriginal>[1], id: string, name: string, bytes: Uint8Array<ArrayBuffer>) {
  const original = await keepOriginal(store, files, id, { name, parts: originalParts(bytes) }, () => {});
  if (!original.ok) throw new Error(original.error);
}

describe('rereadOriginals', () => {
  it('adds what the newer parser reads to an owner the old one imported, leaves an edited Lua trigger, and runs once', async () => {
    vi.stubGlobal('Worker', workers);
    const { store, files } = await server.account();
    const read = await importCard('mira.charx', charx);
    if (!read.ok || !('card' in read)) throw new Error('not a card');
    const made = await importCharacter(store, files, { ...read.card, card: asOld(read.card.card), assets: read.card.assets.filter(({ use }) => !use) }, null, () => {});
    if (!made.ok) throw new Error(made.error);
    const { id } = made.data;
    await kept(store, files, id, 'mira.charx', charx);
    const untouched = await importCharacter(store, files, { ...read.card, card: asOld(read.card.card), assets: [] }, null, () => {});
    if (!untouched.ok) throw new Error(untouched.error);

    expect(await rereadOriginals(store, files, new AbortController().signal)).toEqual({ ok: true, data: { edited: 1 } });
    const character = store.get('character', id)!;
    const { card: again } = character.value;
    expect(again).toMatchObject({ additionalText: 'later', onboarding: { enabled: true, title: 'ask' }, regex: [{ name: 'tr', stage: 'translation' }] });
    expect(again.triggers).toEqual([read.card.card.triggers[0], { ...asOld(read.card.card).triggers[1] }]);
    const assets = store.children('asset', id).map(({ value }) => [value.name, value.use, value.size]).sort();
    expect(assets).toEqual([['night', 'background', backdrop.length], ['smile', undefined, smile.length]]);
    expect(store.get('character', untouched.data.id)!.value.card).toEqual(asOld(read.card.card));
    expect(accountSettings(store).reread).toBe(2);

    const marked = await changeSettings(store, (settings) => ({ ...settings, reread: 0 }));
    if (!marked.ok) throw new Error(marked.error);
    expect(await rereadOriginals(store, files, new AbortController().signal)).toEqual({ ok: true, data: { edited: 1 } });
    expect(store.get('character', id)!.rev).toBe(character.rev);
    expect(store.children('asset', id)).toHaveLength(2);
  });

  it("adds a card's SillyTavern regex scripts after the character's own, once", async () => {
    vi.stubGlobal('Worker', workers);
    const { store, files } = await server.account();
    const scripts = [{ scriptName: 'hide', findRegex: '/<x>/g', replaceString: '', placement: [2], markdownOnly: true }, { scriptName: 'off', findRegex: 'y', placement: [1], disabled: true }];
    const file = strToU8(JSON.stringify({ spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Mira', description: 'd', first_mes: 'hi', extensions: { regex_scripts: scripts } } })) as Uint8Array<ArrayBuffer>;
    const read = await importCard('mira.json', file);
    if (!read.ok || !('card' in read)) throw new Error('not a card');
    const mine = { id: 'mine', name: 'mine', find: 'a', replace: 'b', stage: 'output' as const, flags: null };
    const made = await importCharacter(store, files, { ...read.card, card: { ...read.card.card, regex: [mine] } }, null, () => {});
    if (!made.ok) throw new Error(made.error);
    await kept(store, files, made.data.id, 'mira.json', file);

    expect(await rereadOriginals(store, files, new AbortController().signal)).toEqual({ ok: true, data: { edited: 0 } });
    const character = store.get('character', made.data.id)!;
    expect(character.value.card.regex.map(({ name, stage, off }) => [name, stage, off])).toEqual([['mine', 'output', undefined], ['hide', 'display', undefined], ['off', 'input', true]]);

    const marked = await changeSettings(store, (settings) => ({ ...settings, reread: 1 }));
    if (!marked.ok) throw new Error(marked.error);
    expect(await rereadOriginals(store, files, new AbortController().signal)).toEqual({ ok: true, data: { edited: 0 } });
    expect(store.get('character', made.data.id)!.rev).toBe(character.rev);
  });

  it("gives an imported preset's prompt the default variables it had none of", async () => {
    vi.stubGlobal('Worker', workers);
    const { store, files } = await server.account();
    const file = strToU8(JSON.stringify({ name: 'p', promptTemplate: [{ type: 'plain', type2: 'normal', role: 'system', text: 'hi' }], templateDefaultVariables: 'hp=10' })) as Uint8Array<ArrayBuffer>;
    const read = await importPreset('p.preset', file);
    if (!read.ok) throw new Error('not a preset');
    const saved = await savePreset(store, { ...read, prompt: without(read.prompt, 'variables') });
    if (!saved.ok) throw new Error(saved.error);
    await kept(store, files, saved.data.id, 'p.preset', file);

    expect(await rereadOriginals(store, files, new AbortController().signal)).toEqual({ ok: true, data: { edited: 0 } });
    expect(store.get('prompt', saved.data.id)!.value).toMatchObject({ variables: [['hp', '10']] });
  });
});
