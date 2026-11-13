import { describe, expect, it, vi } from 'vitest';
import { blankCard } from '../../engine/import/card';
import { PLAIN_LUA } from '../../engine/import/types';
import { memoryId } from '../../model/memory';
import { STARTER_PRESETS } from '../../model/settings';
import { startChat } from '../chat/chat-log';
import { testServer } from '../testing';
import { setAccountTaskModel } from '../models/assignment';
import { accountSettings } from '../account-settings';
import { createCharacter, setOwnIllustrate, setOwnTranslate, setTranslate } from '../library/characters';
import { addAgent, addPrompt, COMMENTATOR_ID, ILLUSTRATOR_ID, MEMORY_PROMPT_ID, TRANSLATOR_ID } from '../library/prompts';
import { moveTaskModels, readRow, saveUpgraded, upgradeValue } from './upgrade';

const server = testServer();

const old = { type: 'copilot', label: 'Copilot', account: 'jin', baseUrl: null, protocol: null, secret: 'gho_x', starred: [] };
const upgraded = {
  type: 'copilot',
  label: 'Copilot',
  baseUrl: null,
  protocol: null,
  starred: [],
  accounts: [{ id: 'account-1', secret: 'gho_x', name: 'jin' }],
  turns: { day: 16, groups: [{ id: 'group-1', name: '그룹 1', accounts: ['account-1'] }], anchor: { group: 'group-1', cycle: 0 } },
};

describe('upgradeValue', () => {
  it('gives a connection from before accounts its one account, in a first group where the type is a pool', () => {
    expect(upgradeValue('connection', old)).toEqual(upgraded);
    expect(upgradeValue('connection', { ...old, type: 'openrouter', account: undefined })).toMatchObject({ accounts: [{ id: 'account-1', secret: 'gho_x' }], turns: null });
    expect(upgradeValue('connection', upgraded)).toBeNull();
    expect(upgradeValue('folder', { name: 'secret' })).toBeNull();
  });

  it('moves a character’s greeting translations into its text translations', () => {
    const translation = { text: '안녕', receipt: null, at: 1 };
    const character = { folder: null, greetingTranslations: [{ greeting: 'Hello', language: 'Korean', translation }] };
    expect(upgradeValue('character', character)).toEqual({ folder: null, translations: [{ source: 'Hello', language: 'Korean', translation }] });
    expect(upgradeValue('character', { folder: null, translations: [] })).toBeNull();
  });

  it("gives a character's and a module's scripts ids by place, and turns 상태창 지정's places into those ids", () => {
    const script = (name: string) => ({ name, find: name, replace: '', stage: 'display', flags: null });
    const card = { name: '루나', additionalText: '', regex: [script('a'), script('b')], triggers: [{ kind: 'lua', ...PLAIN_LUA, name: 'main', code: 'x()' }] };
    expect(upgradeValue('character', { card, statusScripts: [1, 5] })).toEqual({
      card: { ...card, regex: [{ ...script('a'), id: 'regex-0' }, { ...script('b'), id: 'regex-1' }], triggers: [{ kind: 'lua', ...PLAIN_LUA, name: 'main', code: 'x()', id: 'trigger-0' }] },
      statusScripts: ['regex-1'],
    });
    expect(upgradeValue('character', { card, greetingTranslations: [] })).toMatchObject({ translations: [], card: { regex: [{ id: 'regex-0' }, { id: 'regex-1' }] } });
    expect(upgradeValue('module', { name: 'Bell', regex: [script('a')], triggers: [] })).toEqual({ name: 'Bell', regex: [{ ...script('a'), id: 'regex-0' }], triggers: [] });
  });

  it('reads a place a tab on the old build added among ids through the card as it stands, once each', () => {
    const regex = [{ id: 'new', name: 'n' }, { id: 'regex-0', name: 'a' }];
    expect(upgradeValue('character', { card: { regex, triggers: [], additionalText: '' }, statusScripts: ['regex-0', 0, 1] })).toEqual({ card: { regex, triggers: [], additionalText: '' }, statusScripts: ['regex-0', 'new'] });
  });

  it('drops the translation switches a character kept before they were shared, and leaves its own', () => {
    expect(upgradeValue('character', { folder: null, translate: { replies: true }, ownTranslate: { replies: false } })).toEqual({ folder: null, ownTranslate: { replies: false } });
  });

  it('drops 옆에 두기 from a character', () => {
    expect(upgradeValue('character', { folder: null, keepStatus: true })).toEqual({ folder: null });
  });

  it("drops a character's picture height cap, and its pictures once nothing else is set", () => {
    expect(upgradeValue('character', { folder: null, pictures: { peek: 30, most: 90 } })).toEqual({ folder: null, pictures: { peek: 30 } });
    expect(upgradeValue('character', { folder: null, pictures: { most: 90 } })).toEqual({ folder: null });
  });

  it("reads a character's and a module's opaque block effects again once this app runs them, and leaves loops opaque", () => {
    const concat = { type: 'v2ConcatString', source1: 'a', source1Type: 'value', source2: 'b', source2Type: 'value', outputVar: 'ab', indent: 0 };
    const loop = { type: 'v2LoopNTimes', value: '2', valueType: 'value', indent: 0 };
    const trigger = { id: 'trigger-0', kind: 'blocks', name: 'go', on: 'manual', conditions: [], effects: [{ kind: 'opaque', type: 'v2ConcatString', raw: concat }, { kind: 'opaque', type: 'v2LoopNTimes', raw: loop }] };
    const effects = [{ kind: 'call', type: 'v2ConcatString', inputs: [{ kind: 'text', text: 'a' }, { kind: 'text', text: 'b' }], name: '', output: 'ab', option: '' }, trigger.effects[1]];
    expect(upgradeValue('character', { card: { regex: [], triggers: [trigger], additionalText: '' } })).toEqual({ card: { regex: [], triggers: [{ ...trigger, effects }], additionalText: '' } });
    expect(upgradeValue('module', { regex: [], triggers: [trigger] })).toEqual({ regex: [], triggers: [{ ...trigger, effects }] });
    expect(upgradeValue('module', { regex: [], triggers: [{ ...trigger, effects: [trigger.effects[1]] }] })).toBeNull();
  });

  it("reads a Lua trigger kept as its code alone as Risu's new one, and a block trigger's opaque later Lua as Lua", () => {
    const bare = { id: 'trigger-0', kind: 'lua', name: 'main', code: 'x()' };
    const later = { id: 'trigger-1', kind: 'blocks', name: 'go', on: 'output', conditions: [], effects: [{ kind: 'opaque', type: 'triggerlua', raw: { type: 'triggerlua', code: 'y()', indent: 0 } }] };
    const read = [{ ...bare, on: 'start', conditions: [], effects: [] }, { ...later, effects: [{ kind: 'lua', code: 'y()' }] }];
    expect(upgradeValue('character', { card: { regex: [], additionalText: '', triggers: [bare, later] } })).toEqual({ card: { regex: [], additionalText: '', triggers: read } });
    expect(upgradeValue('module', { regex: [], triggers: [bare, later] })).toEqual({ regex: [], triggers: read });
    expect(upgradeValue('module', { regex: [], triggers: read })).toBeNull();
  });

  it("reads a character's and a module's toggles kept as Risu's text into lines on the backup's reader, an unread line kept", () => {
    const text = 'ring=벨\n모드 고르기';
    const lines = [{ key: 'ring', label: '벨', kind: 'check', default: '0' }, { kind: 'unread', text: '모드 고르기' }];
    const module = { name: 'Bell', description: '', namespace: null, regex: [], triggers: [], toggles: text, loreFolders: [] };
    const character = { card: { ...blankCard('루나'), toggles: text }, folder: null, loreFolders: [] };
    const row = (kind: string, value: unknown) => readRow({ id: 'x', kind, parent: null, rev: 1, value })?.value;
    expect(row('module', module)).toEqual({ ...module, toggles: lines });
    expect(row('character', character)).toEqual({ ...character, card: { ...character.card, toggles: lines } });
  });

  it("gives a card from before it kept Risu's additionalText an empty one", () => {
    expect(upgradeValue('character', { folder: null, card: { regex: [], triggers: [] } })).toEqual({ folder: null, card: { regex: [], triggers: [], additionalText: '' } });
  });

  it("puts an account's own looks after the starter presets, joins what an older app still writes beside them, and leaves a current one alone", () => {
    const mine = { id: 'mine', name: '내 것', look: { theme: 'dark' } };
    expect(upgradeValue('settings', { models: {}, looks: [mine] })).toEqual({ models: {}, presets: [...STARTER_PRESETS, mine] });
    const kept = [STARTER_PRESETS[1]!, mine];
    expect(upgradeValue('settings', { models: {}, presets: kept, looks: [mine, { ...mine, id: 'later' }] })).toEqual({ models: {}, presets: [...kept, { ...mine, id: 'later' }] });
    expect(upgradeValue('settings', { models: {}, presets: [] })).toBeNull();
    expect(upgradeValue('settings', { models: {} })).toBeNull();
  });

  it('leaves a current character or module alone, so the write-back touches only old ones', () => {
    expect(upgradeValue('character', { folder: null, card: { regex: [], triggers: [], additionalText: '' } })).toBeNull();
    expect(upgradeValue('character', { card: { regex: [{ id: 'x' }], triggers: [{ id: 'y' }], additionalText: '' }, statusScripts: ['x'] })).toBeNull();
    expect(upgradeValue('module', { regex: [{ id: 'x' }], triggers: [] })).toBeNull();
  });

  it('holds an old connection upgraded as it is read, and writes it back once', async () => {
    const { store, open } = await server.account();
    const created = await store.create('connection', old as never);
    if (!created.ok) throw new Error(created.error);
    const other = await open();
    await other.pull();
    expect(other.get('connection', created.data.id)?.value).toEqual(upgraded);
    await saveUpgraded(other);
    expect(other.takeUpgraded()).toEqual([]);

    const third = await open();
    await third.pull();
    expect(third.get('connection', created.data.id)?.value).toEqual(upgraded);
    expect(third.takeUpgraded()).toEqual([]);
  });

  it('writes modules whose scripts had no ids back once, with them, in one request', async () => {
    const { store, open } = await server.account();
    const old = { name: 'Bell', description: '', namespace: null, regex: [{ name: 'a', find: 'a', replace: '', stage: 'display', flags: null }], triggers: [], toggles: '', loreFolders: [] };
    const ids = await Promise.all([1, 2, 3].map(async () => {
      const created = await store.create('module', old as never);
      if (!created.ok) throw new Error(created.error);
      return created.data.id;
    }));
    const other = await open();
    await other.pull();
    const sent = vi.spyOn(globalThis, 'fetch');
    await saveUpgraded(other);
    expect(sent.mock.calls.filter(([url]) => String(url).endsWith('objects/batch'))).toHaveLength(1);
    sent.mockRestore();
    const third = await open();
    await third.pull();
    for (const id of ids) expect(third.get('module', id)?.value.regex).toEqual([{ ...old.regex[0], id: 'regex-0' }]);
    expect(third.takeUpgraded()).toEqual([]);
  });

  it('gives a chat memory from before chapters none, and writes it back once its chat is loaded', async () => {
    const memory = { records: [], state: [], threads: [{ id: 't', text: 'They meet again.', opened: null }] };
    expect(upgradeValue('memory', memory)).toEqual({ ...memory, chapters: [] });
    expect(upgradeValue('memory', { ...memory, chapters: [] })).toBeNull();

    const { store, open } = await server.account();
    const chat = crypto.randomUUID();
    await server.hold(store, chat);
    await startChat(store, chat, { title: null, character: null, models: {} }, null);
    await store.create('memory', memory as never, { id: memoryId(chat), parent: chat });
    const other = await open();
    await server.hold(other, chat);
    expect(other.get('memory', memoryId(chat))?.value).toEqual({ ...memory, chapters: [] });
    await saveUpgraded(other);

    const third = await open();
    await server.hold(third, chat);
    expect(third.get('memory', memoryId(chat))?.value).toEqual({ ...memory, chapters: [] });
    expect(third.takeUpgraded()).toEqual([]);
  });
});


it('upgrades old encrypted ledger and stream values through the backup/restore reader, never inventing a denominator or rewriting append-only rows', async () => {
  const call = { id: crypto.randomUUID(), connection: 'connection', source: 'Source', model: 'm', modelName: 'M', usage: { inputTokens: 123 }, cost: null };
  const oldLedger = { id: crypto.randomUUID(), kind: 'ledger', parent: 'settings', rev: 1, value: { type: 'call', call, at: 10, chat: null, character: null } };
  const oldStream = { id: crypto.randomUUID(), kind: 'stream', parent: 'chat', rev: 2, value: { key: {}, call, at: 10, result: 'reply', for: { kind: 'reply', message: null, replaces: null, continues: null } } };
  const unavailable = { measurement: { kind: 'unavailable', reason: 'historical' }, fit: null, retries: [], eligible: false };
  expect(readRow(JSON.parse(JSON.stringify(oldLedger)))?.value).toMatchObject({ call: { usage: { inputTokens: 123 }, calibration: unavailable } });
  expect(readRow(JSON.parse(JSON.stringify(oldStream)))?.value).toMatchObject({ calibration: unavailable });
  const current = readRow(oldLedger)!;
  expect(upgradeValue('ledger', current.value)).toBeNull();
  expect(readRow(JSON.parse(JSON.stringify(current)))).toEqual(current);
  expect(upgradeValue('stream', readRow(oldStream)!.value)).toBeNull();
  const { store } = await server.account();
  const take = vi.spyOn(store, 'takeUpgraded').mockReturnValue([{ id: oldLedger.id, kind: 'ledger' }]);
  const batch = vi.spyOn(store, 'batch');
  await saveUpgraded(store);
  expect(batch).not.toHaveBeenCalled();
  take.mockRestore();
  batch.mockRestore();
});

it('gives a call’s row saved before purposes a purpose not known, and leaves a booked row and a current row as they are', () => {
  const call = { id: crypto.randomUUID(), connection: 'connection', source: 'Source', model: 'm', modelName: 'M', usage: null, cost: null, calibration: { measurement: { kind: 'unavailable', reason: 'historical' }, fit: null, retries: [], eligible: false } };
  for (const type of ['call', 'input-refusal']) {
    const old = { type, call, at: 10, chat: null, character: null };
    expect(upgradeValue('ledger', old)).toEqual({ ...old, purpose: null });
    expect(upgradeValue('ledger', { ...old, purpose: 'reply' })).toBeNull();
  }
  expect(upgradeValue('ledger', { type: 'cost', call: call.id, cost: null, at: 11 })).toBeNull();
});

it('moves a task prompt’s model into every layer that runs the prompt and has none, then off the prompt, the same when run again', () =>
  server.withSession(async ({ store }) => {
    const ref = (model: string) => ({ connection: 'c', model });
    const pin = (id: string, model: string) => store.update('prompt', id, (current) => ({ ...current, model: ref(model) }) as never);
    const other = crypto.randomUUID();
    await addPrompt(store, 'Other', 'translate', other);
    const agent = await addAgent(store, 'pre', 'Scene');
    if (!agent.ok) throw new Error(agent.error);
    for (const [id, model] of [[TRANSLATOR_ID, 'tr'], [other, 'other'], [ILLUSTRATOR_ID, 'scene'], [MEMORY_PROMPT_ID, 'memory'], [COMMENTATOR_ID, 'mascot'], [agent.data.id, 'agent']] as const) await pin(id, model);
    // 마스코트 has its own model already, so its prompt's is dropped. Of the characters' own 번역, one follows the default
    // prompt, one chooses another, one has its own model.
    await setAccountTaskModel(store, 'mascot', ref('kept'));
    const [follows, chooses, owns] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of [follows, chooses, owns]) {
      await createCharacter(store, id, id);
      await setOwnTranslate(store, id, true);
    }
    await setOwnIllustrate(store, follows, true);
    await setTranslate(store, chooses, { prompt: other });
    await setTranslate(store, owns, { model: ref('own') });

    const state = () => ({ settings: accountSettings(store), characters: store.list('character').map(({ value }) => [value.ownTranslate, value.ownIllustrate]), prompts: store.list('prompt').map(({ value }) => value) });
    await moveTaskModels(store);
    const moved = state();
    expect(moved.settings).toMatchObject({ translate: { model: ref('tr') }, illustrate: { sceneModel: ref('scene') }, memoryModel: ref('memory'), mascotModel: ref('kept') });
    expect(moved.settings.prereadModel).toBeUndefined();
    const own = (id: string) => store.get('character', id)!.value;
    expect([own(follows).ownTranslate?.model, own(follows).ownIllustrate?.sceneModel, own(chooses).ownTranslate?.model, own(owns).ownTranslate?.model]).toEqual([ref('tr'), ref('scene'), ref('other'), ref('own')]);
    expect(moved.prompts.filter((prompt) => 'model' in prompt).map(({ name }) => name)).toEqual(['Scene']);
    await moveTaskModels(store);
    expect(state()).toEqual(moved);
  }));
