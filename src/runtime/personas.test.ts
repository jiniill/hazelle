import { describe, expect, it } from 'vitest';
import { setChatOwn, startChat } from './chat-log';
import { addFirstPersona, addPersona, chatPersona, chatsHolding, copyPersona, pinPersona, rebindChats, recordChatPersonas, removePersona, restorePersona, setCurrentPersona } from './personas';
import { testServer } from './testing';
import { blankCard } from '../engine/import/card';
import { likenessId } from '../model/likeness';

const server = testServer();

describe('personas', () => {
  it('gives a chat not saved yet the first persona, named after the username, then the current one, refuses to delete the current one, and reads a deleted persona of its own as missing', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPersona(store, { name: '진', description: '여행자', picture: null }), addPersona(store, { name: '린', description: '학자', picture: null })]);
    const [jin, rin] = [first, second].map((added) => (added.ok ? added.data.id : ''));
    const created = await store.create('chat', { title: null, character: null, models: {} });
    const chat = created.ok ? created.data.id : '';
    const read = () => store.get('chat', chat)!.value;

    expect(chatPersona(store, read())).toEqual({ kind: 'missing', from: 'current' });
    await addFirstPersona(store, 'jin');
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'current', persona: { value: { name: 'jin', description: '' } } });
    await setCurrentPersona(store, jin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'current', persona: { id: jin } });
    expect(await removePersona(store, jin!)).toEqual({ ok: false, error: 'current' });

    await setChatOwn(store, chat, 'persona', rin!);
    const removed = await removePersona(store, rin!);
    expect(chatPersona(store, read())).toEqual({ kind: 'missing', from: 'chat' });
    expect(removed.ok && store.get('persona', rin!)?.value.deleted).toEqual(expect.any(Number));
    await restorePersona(store, rin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'chat', persona: { id: rin } });
  });

  it('gives a chat its character’s 고정 over the current persona, under the chat’s own pick, and reads a deleted 고정 as missing', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPersona(store, { name: '진', description: '', picture: null }), addPersona(store, { name: '린', description: '', picture: null })]);
    const [jin, rin] = [first, second].map((added) => (added.ok ? added.data.id : ''));
    await setCurrentPersona(store, jin!);
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
    const luna = character.ok ? character.data.id : '';
    const created = await store.create('chat', { title: null, character: luna, models: {} });
    const chat = created.ok ? created.data.id : '';
    const read = () => store.get('chat', chat)!.value;

    await pinPersona(store, luna, rin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'character', persona: { id: rin } });
    await setChatOwn(store, chat, 'persona', jin!);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'chat', persona: { id: jin } });
    await setChatOwn(store, chat, 'persona', null);
    await removePersona(store, rin!);
    expect(chatPersona(store, read())).toEqual({ kind: 'missing', from: 'character' });
    await pinPersona(store, luna, null);
    expect(chatPersona(store, read())).toMatchObject({ kind: 'persona', from: 'current', persona: { id: jin } });
  });

  it('saves a chat with the persona it reads, its 고정 or the current one, which a later pick of another leaves as it is', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPersona(store, { name: '진', description: '', picture: null }), addPersona(store, { name: '린', description: '', picture: null })]);
    const [jin, rin] = [first, second].map((added) => (added.ok ? added.data.id : ''));
    await setCurrentPersona(store, jin!);
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
    const luna = character.ok ? character.data.id : '';
    await pinPersona(store, luna, rin!);
    const [plain, pinned] = [crypto.randomUUID(), crypto.randomUUID()];
    await startChat(store, plain, { title: null, character: null, models: {} }, null);
    await startChat(store, pinned, { title: null, character: luna, models: {} }, null);

    await setCurrentPersona(store, rin!);
    expect(store.get('chat', plain)!.value.persona).toBe(jin);
    expect(chatPersona(store, store.get('chat', plain)!.value)).toMatchObject({ from: 'chat', persona: { id: jin } });
    expect(store.get('chat', pinned)!.value.persona).toBe(rin);
  });

  it('records once, binned chats too, the persona each chat saved without one reads, and leaves one that holds its own', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPersona(store, { name: '진', description: '', picture: null }), addPersona(store, { name: '린', description: '', picture: null })]);
    const [jin, rin] = [first, second].map((added) => (added.ok ? added.data.id : ''));
    await setCurrentPersona(store, jin!);
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
    const luna = character.ok ? character.data.id : '';
    await pinPersona(store, luna, rin!);
    const make = async (chat: Parameters<typeof store.create<'chat'>>[1]) => { const made = await store.create('chat', chat); return made.ok ? made.data.id : ''; };
    const plain = await make({ title: null, character: null, models: {} });
    const binned = await make({ title: null, character: null, models: {}, deleted: 1 });
    const pinned = await make({ title: null, character: luna, models: {} });
    const own = await make({ title: null, character: null, models: {}, persona: rin! });
    const ownRev = store.get('chat', own)!.rev;

    await recordChatPersonas(store);
    expect([plain, binned, pinned, own].map((id) => store.get('chat', id)!.value.persona)).toEqual([jin, jin, rin, rin]);
    expect(store.get('chat', own)!.rev).toBe(ownRev);
    const revs = [plain, binned, pinned].map((id) => store.get('chat', id)!.rev);
    await setCurrentPersona(store, rin!);
    await recordChatPersonas(store);
    expect([plain, binned, pinned].map((id) => store.get('chat', id)!.rev)).toEqual(revs);
  });

  it('moves the live chats holding one persona to another, and back by the same ids, leaving a binned one and one moved there since', async () => {
    const { store } = await server.account();
    const [first, second] = await Promise.all([addPersona(store, { name: '진', description: '', picture: null }), addPersona(store, { name: '린', description: '여행자', picture: null })]);
    const [jin, rin] = [first, second].map((added) => (added.ok ? added.data.id : '')) as [string, string];
    const make = async (chat: Parameters<typeof store.create<'chat'>>[1]) => { const made = await store.create('chat', chat); return made.ok ? made.data.id : ''; };
    const chats = await Promise.all([jin, jin, jin, rin].map((persona, at) => make({ title: null, character: null, models: {}, persona, ...(at === 2 && { deleted: 1 }) })));
    const [one, two] = chats as [string, string];

    const moved = chatsHolding(store, jin);
    expect(moved.sort()).toEqual([one, two].sort());
    expect(await rebindChats(store, moved, rin)).toEqual({ ok: true, data: null });
    expect(chats.map((id) => store.get('chat', id)!.value.persona)).toEqual([rin, rin, jin, rin]);
    await rebindChats(store, moved, jin);
    expect(chats.map((id) => store.get('chat', id)!.value.persona)).toEqual([jin, jin, jin, rin]);
  });

  it('copies a persona under its new name with its 삽화 profiles, leaving the alias and the chats with the original', async () => {
    const { store } = await server.account();
    const added = await addPersona(store, { name: '진', description: '여행자', picture: 'thumb', alias: '첫째', modules: ['m'], folder: 'f' });
    const jin = added.ok ? added.data.id : '';
    const likeness = { portraits: [{ name: '진', aliases: [], look: 'boy', outfits: [], artist: '', source: 'user' as const }], at: 1, receipt: null };
    await store.create('likeness', likeness, { id: likenessId(jin), parent: jin });
    await store.create('chat', { title: null, character: null, models: {}, persona: jin });

    const copy = crypto.randomUUID();
    expect((await copyPersona(store, jin, '진 (사본)', copy)).ok).toBe(true);
    expect(store.get('persona', copy)?.value).toEqual({ name: '진 (사본)', description: '여행자', picture: 'thumb', modules: ['m'], folder: 'f' });
    expect(store.get('likeness', likenessId(copy))).toMatchObject({ parent: copy, value: likeness });
    expect(chatsHolding(store, copy)).toEqual([]);
  });
});
