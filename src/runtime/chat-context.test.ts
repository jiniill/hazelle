import { describe, expect, it } from 'vitest';
import { fold, type Chat } from '../model/chat';
import { bareModel } from '../connectors/chat-completions';
import type { Starred } from '../connectors/types';
import { blankCard } from '../engine/import/card';
import { budgetOf, evaluateChat, scopeOf, setSharedLoreScan, tokenLimits } from './chat-context';
import { appendUserMessage, startChat } from './chat-log';
import { addLore, setCharacterLoreScan } from './lore';
import { testServer } from './testing';

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
