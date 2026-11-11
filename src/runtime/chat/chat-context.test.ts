import { describe, expect, it } from 'vitest';
import { fold, type Chat } from '../../model/chat';
import { bareModel } from '../../connectors/chat-completions';
import type { Starred } from '../../connectors/types';
import { blankCard } from '../../engine/import/card';
import type { StatusDefinition } from '../../model/status';
import { budgetOf, evaluateChat, packsOf, scopeOf, setSharedLoreScan, statusOf, tokenLimits } from './chat-context';
import { chatPrompt } from '../library/prompts';
import { appendUserMessage, setStatusByHand, startChat } from './chat-log';
import { addLore, setCharacterLoreScan } from '../library/lore';
import { testServer } from '../testing';

const server = testServer();

describe('evaluateChat', () => {
  it("shows a message's inlays from the chat's own, by their exact ids", async () => {
    const { store, files } = await server.account();
    const id = crypto.randomUUID();
    await server.hold(store, id);
    const chat: Chat = { title: null, character: null, models: {} };
    await startChat(store, id, chat, null);
    await appendUserMessage(store, id, { id: crypto.randomUUID(), text: '봐 {{inlay::risu-id}}{{inlay::risu-i}}' });
    const saved = await files.save([new Uint8Array(2)]);
    if (!saved.ok) throw new Error(saved.error);
    const created = await store.create('inlay', { name: 'risu-id', type: 'image/png', size: 2, file: saved.data[0]! }, { parent: id });
    if (!created.ok) throw new Error(created.error);
    const { texts } = await evaluateChat({ store }, id, chat, fold(store.children('entry', id)));
    expect(texts).toEqual([`봐 <img src="inlay:${created.data.id}"/><span data-inlay-missing></span>`]);
  });
});

describe('scopeOf', () => {
  it("holds the character's lorebook, then a saved chat's own, then the modules'", async () => {
    const { store } = await server.account();
    const module = await store.create('module', { name: '종', description: '', namespace: null, regex: [], triggers: [], toggles: [], loreFolders: [] });
    if (!module.ok) throw new Error(module.error);
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [], modules: [module.data.id] });
    if (!character.ok) throw new Error(character.error);
    const id = crypto.randomUUID();
    const chat: Chat = { title: null, character: character.data.id, models: {}, loreFolders: [{ id: 'f', name: '장소' }] };
    await store.create('chat', chat, { id });
    for (const owner of [module.data.id, id, character.data.id]) await addLore(store, owner, null, crypto.randomUUID());
    const scope = scopeOf({ store }, id, chat, []);
    expect(scope.lore.map(({ parent }) => parent)).toEqual([character.data.id, id, module.data.id]);
    expect(scope.loreFolders).toEqual({ [id]: ['장소'] });
    expect(scopeOf({ store }, null, chat, []).lore.map(({ parent }) => parent)).toEqual([character.data.id, module.data.id]);
  });

  it("takes the character's own scan settings over the account's, with 재귀 검색 off by default", async () => {
    const { store } = await server.account();
    const card = blankCard('루나');
    const character = await store.create('character', { card: { ...card, loreSettings: { ...card.loreSettings, tokenBudget: 1500 } }, folder: null, loreFolders: [], modules: [] });
    if (!character.ok) throw new Error(character.error);
    await setSharedLoreScan(store, 'tokenBudget', 70_000);
    const chat: Chat = { title: null, character: character.data.id, models: {} };
    const scan = () => scopeOf({ store }, null, chat, []).loreScan;
    expect(scan()).toEqual({ scanDepth: 5, tokenBudget: 1500, recursive: false, fullWordMatching: false });
    await setCharacterLoreScan(store, character.data.id, { tokenBudget: null, recursive: true });
    expect(scan()).toMatchObject({ tokenBudget: 70_000, recursive: true });
    await setSharedLoreScan(store, 'scanDepth', 8);
    expect(scopeOf({ store }, null, { title: null, character: null, models: {} }, []).loreScan).toMatchObject({ scanDepth: 8, recursive: false });
  });
});

describe("scopeOf with a state declared", () => {
  it('holds the definitions and the state the messages leave', async () => {
    const { store } = await server.account();
    const definition: StatusDefinition = { id: 'd', name: '기본', writer: 'after', fields: [{ id: 'hp', name: 'HP', kind: 'gauge', min: 0, max: 10, start: 5 }], groups: [], logs: [] };
    const character = await store.create('character', { card: { ...blankCard('루나'), status: definition }, folder: null, loreFolders: [], modules: [] });
    if (!character.ok) throw new Error(character.error);
    const id = crypto.randomUUID();
    await server.hold(store, id);
    const chat: Chat = { title: null, character: character.data.id, models: {} };
    await startChat(store, id, chat, null);
    const said = crypto.randomUUID();
    await appendUserMessage(store, id, { id: said, text: '안녕' });
    expect(scopeOf({ store }, id, chat, fold(store.children('entry', id))).status).toEqual({ definitions: [definition], state: { d: { values: { hp: 5 }, groups: {}, logs: {} } } });
    await setStatusByHand(store, id, said, { definition: 'd', kind: 'move', field: 'hp', by: 3 });
    expect(scopeOf({ store }, id, chat, fold(store.children('entry', id))).status.state).toEqual({ d: { values: { hp: 8 }, groups: {}, logs: {} } });
  });
});

describe('statusOf', () => {
  it("reads the prompt's definition, then the card's, then the modules', a second one of an id declaring nothing", async () => {
    const { store } = await server.account();
    const definition = (id: string, name: string): StatusDefinition => ({ id, name, writer: 'after', fields: [], groups: [], logs: [] });
    const module = await store.create('module', { name: '종', description: '', namespace: null, regex: [], triggers: [], toggles: [], loreFolders: [], status: definition('module', '모듈') });
    if (!module.ok) throw new Error(module.error);
    const character = await store.create('character', { card: { ...blankCard('루나'), status: definition('card', '카드') }, folder: null, loreFolders: [], modules: [module.data.id] });
    if (!character.ok) throw new Error(character.error);
    const prompt = await store.create('prompt', { name: '기본', blocks: [], toggles: [], authorNote: '', models: {}, status: definition('card', '프롬프트') });
    if (!prompt.ok) throw new Error(prompt.error);
    const chat: Chat = { title: null, character: character.data.id, models: {}, prompt: prompt.data.id };
    expect(statusOf(chatPrompt(store, chat), packsOf(store, chat)).map(({ id, name }) => [id, name])).toEqual([['card', '프롬프트'], ['module', '모듈']]);
    expect(statusOf(chatPrompt(store, { ...chat, prompt: undefined }), packsOf(store, chat)).map(({ name }) => name)).toEqual(['카드', '모듈']);
  });
});

describe('budgetOf', () => {
  it('reserves no reply for a starred model whose catalog output limit is as large as its context, until one is set', () => {
    const shared: Starred = { ...bareModel('m'), contextLength: 1_000_000, maxOutput: 1_000_000 };
    expect(budgetOf(shared, {})).toBe(1_000_000);
    expect(tokenLimits(shared, {})).toEqual({ hard: 1_000_000, user: null, output: 0 });
    expect(budgetOf(shared, { maxOutput: 8000 })).toBe(992_000);
    expect(tokenLimits(shared, { maxOutput: 8000 }).output).toBe(8000);
    expect(budgetOf({ ...shared, maxOutput: 128_000 }, {})).toBe(872_000);
  });
});
