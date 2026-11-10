import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER } from '../../engine/import/convert';
import type { Character } from '../../model/library';
import { addLore, addLoreFolder, editLore, loreFolderRemoval, removeLore, removeLoreFolder, renameLoreFolder, restoreLore, restoreLoreFolder, upsertChatLore } from './lore';
import type { PackOwner } from '../../model/library';
import type { ObjectStore } from '../store/store';
import { testServer } from '../testing';
import { blankCard } from '../../engine/import/card';

const server = testServer();

async function owned(store: ObjectStore): Promise<PackOwner> {
  const character: Character = { card: blankCard('루나'), folder: null, loreFolders: [{ id: 'sea', name: '바다' }] };
  const created = await store.create('character', character);
  if (!created.ok) throw new Error(created.error);
  return { kind: 'character', id: created.data.id };
}

async function added(store: ObjectStore, owner: string, folder: string | null) {
  const saved = await addLore(store, owner, folder, crypto.randomUUID());
  if (!saved.ok) throw new Error(saved.error);
  return saved.data;
}

describe('addLore', () => {
  it('adds an entry that is on, found by keys and in the lorebook slot, after the last one, in the folder it was added in', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const first = await added(store, owner.id, null);
    expect(first.parent).toBe(owner.id);
    expect(first.value).toMatchObject({ enabled: true, constant: false, selective: false, position: null, priority: null, folder: null, insertionOrder: DEFAULT_ORDER });
    await editLore(store, first.id, { insertionOrder: 250 });
    expect((await added(store, owner.id, 'sea')).value).toMatchObject({ folder: 'sea', insertionOrder: 251 });
  });
});

describe('editLore', () => {
  it('changes only the fields given', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const entry = await added(store, owner.id, null);
    await editLore(store, entry.id, { keys: ['등대'] });
    await editLore(store, entry.id, { content: '등대가 있다.' });
    expect(store.get('lore', entry.id)?.value).toMatchObject({ keys: ['등대'], content: '등대가 있다.', enabled: true });
  });
});

describe('removeLore', () => {
  it('removes the entry at once, and restoreLore brings it back under its id', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const entry = await added(store, owner.id, null);
    const removed = await removeLore(store, entry.id);
    if (!removed.ok) throw new Error(removed.error);
    expect(store.children('lore', owner.id)).toEqual([]);
    await restoreLore(store, removed.data);
    expect(store.children('lore', owner.id).map(({ id }) => id)).toEqual([entry.id]);
  });
});

describe('lore folders', () => {
  it('adds and renames a folder on the owner', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    await addLoreFolder(store, owner, '마을');
    const town = store.get('character', owner.id)!.value.loreFolders[1]!;
    await renameLoreFolder(store, owner, town.id, '항구 마을');
    expect(store.get('character', owner.id)?.value.loreFolders).toEqual([{ id: 'sea', name: '바다' }, { id: town.id, name: '항구 마을' }]);
  });

  it('moves a removed folder’s entries out of every folder, and 되돌리기 puts the folder and its entries back', async () => {
    const { store } = await server.account();
    const owner = await owned(store);
    const inside = await added(store, owner.id, 'sea');
    const removal = loreFolderRemoval(store, owner, 'sea')!;
    expect(await removeLoreFolder(store, owner, removal)).toEqual({ ok: true, data: null });
    expect(store.get('character', owner.id)?.value.loreFolders).toEqual([]);
    expect(store.get('lore', inside.id)?.value.folder).toBeNull();
    await restoreLoreFolder(store, owner, removal);
    expect(store.get('character', owner.id)?.value.loreFolders).toEqual([{ id: 'sea', name: '바다' }]);
    expect(store.get('lore', inside.id)?.value.folder).toBe('sea');
  });
});

describe('upsertChatLore', () => {
  it("adds an entry of a new name, and one of a known name takes the place of every chat entry of that name, keeping the first's id and folder", async () => {
    const { store } = await server.account();
    const chat = await store.create('chat', { title: null, character: null, models: {}, loreFolders: [{ id: 'sea', name: '바다' }] });
    if (!chat.ok) throw new Error(chat.error);
    const first = await added(store, chat.data.id, 'sea');
    await added(store, chat.data.id, null);
    const entry = { ...first.value, keys: ['등대'], content: '불이 켜졌다', constant: true };
    expect(await upsertChatLore(store, chat.data.id, entry)).toEqual({ ok: true, data: null });
    expect(await upsertChatLore(store, chat.data.id, { ...entry, name: '항구' })).toEqual({ ok: true, data: null });
    expect(store.children('lore', chat.data.id).map(({ id, value }) => [id, value])).toEqual([
      [first.id, { ...entry, folder: 'sea' }],
      [expect.any(String), { ...entry, name: '항구', folder: null }],
    ]);
  });
});
