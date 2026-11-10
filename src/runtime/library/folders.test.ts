import { describe, expect, it } from 'vitest';
import { addPersona, removePersona } from './personas';
import { createCharacter, seedOrder } from './characters';
import { ORDER_ID } from '../../model/order';
import { createFolder, filingOf, folderRemoval, moveBack, moveInto, removeFolder, restoreFolder } from './folders';
import { removeChat } from '../chat/chat-log';
import { testServer } from '../testing';

const server = testServer();

describe('folders', () => {
  it('keeps the first order written and files a character first in 직접 순서', async () => {
    const { store } = await server.account();
    const order = () => store.get('order', ORDER_ID)?.value.ids;
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of [a, b, c]) await createCharacter(store, id, id);
    await seedOrder(store, [a, b, c]);
    await seedOrder(store, [c, b, a]);
    expect(order()).toEqual([a, b, c]);
    const folder = await createFolder(store, 'character', '즐겨찾기', null);
    await moveInto(store, 'character', [c], folder.ok ? folder.data.id : null);
    expect(order()).toEqual([c, a, b]);
  });

  it('takes a move back to the folders and the order it left, but not for one moved on since', async () => {
    const { store } = await server.account();
    const order = () => store.get('order', ORDER_ID)?.value.ids;
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of [a, b, c]) await createCharacter(store, id, id);
    await seedOrder(store, [a, b, c]);
    const made = await createFolder(store, 'character', '즐겨찾기', null);
    const kept = made.ok ? made.data.id : '';
    await moveInto(store, 'character', [b], kept);
    const filing = filingOf(store, 'character', [b, c]);
    await moveInto(store, 'character', [b, c], null);
    expect(order()).toEqual([b, c, a]);
    await moveBack(store, filing, null);
    expect([store.get('character', b)?.value.folder, store.get('character', c)?.value.folder, order()]).toEqual([kept, null, [b, a, c]]);

    const people = await Promise.all(['진', '린'].map((name) => addPersona(store, { name, description: '', picture: null })));
    const [jin, rin] = people.map((added) => (added.ok ? added.data.id : ''));
    const [folder, later] = await Promise.all(['판타지', '나중에'].map(async (name) => {
      const saved = await createFolder(store, 'persona', name, null);
      return saved.ok ? saved.data.id : '';
    }));
    const persons = filingOf(store, 'persona', [jin!, rin!]);
    await moveInto(store, 'persona', [jin!, rin!], folder!);
    await moveInto(store, 'persona', [rin!], later!);
    await moveBack(store, persons, folder!);
    expect(['folder' in store.get('persona', jin!)!.value, store.get('persona', rin!)?.value.folder]).toEqual([false, later]);
  });


  it("takes a middle folder with the folders inside it and moves its kind's things, 휴지통's too, to the folder it sat in, and brings all back", async () => {
    const { store } = await server.account();
    const made = async (name: string, parent: string | null, kind: 'persona' | 'character' = 'persona') => {
      const saved = await createFolder(store, kind, name, parent);
      return saved.ok ? saved.data.id : '';
    };
    const top = await made('판타지', null);
    const middle = await made('기사단', top);
    const inner = await made('학원물', middle);
    const theirs = await made('기사단', null, 'character');
    const people = await Promise.all(['진', '린', '현'].map((name) => addPersona(store, { name, description: '', picture: null })));
    const [jin, rin, hyun] = people.map((added) => (added.ok ? added.data.id : ''));
    await moveInto(store, 'persona', [jin!], inner);
    await moveInto(store, 'persona', [rin!], middle);
    await moveInto(store, 'persona', [hyun!], top);
    await removePersona(store, rin!);
    const folderOf = (id: string) => store.get('persona', id)!.value.folder;

    expect(folderRemoval(store, theirs)?.kind).toBe('character');
    const removal = folderRemoval(store, middle)!;
    expect([removal.kind, removal.up?.id, removal.folders.map(({ id }) => id)]).toEqual(['persona', top, [middle, inner]]);
    await removeFolder(store, removal);
    expect([folderOf(jin!), folderOf(rin!), folderOf(hyun!)]).toEqual([top, top, top]);
    expect([store.get('folder', middle), store.get('folder', inner), store.get('folder', theirs)?.value.of]).toEqual([null, null, undefined]);

    await restoreFolder(store, removal);
    expect([folderOf(jin!), folderOf(rin!), store.get('folder', inner)?.value]).toEqual([inner, middle, { name: '학원물', parent: middle, of: 'persona' }]);

    const outermost = folderRemoval(store, top)!;
    await removeFolder(store, outermost);
    expect('folder' in store.get('persona', hyun!)!.value).toBe(false);
  });

  it("makes a chat folder for one character, files no other character's chat in it, and its removal moves only that character's chats up, 휴지통's too, and back", async () => {
    const { store } = await server.account();
    const [luna, mira] = [crypto.randomUUID(), crypto.randomUUID()];
    for (const id of [luna, mira]) await createCharacter(store, id, id);
    const made = async (name: string, parent: string | null) => {
      const saved = await createFolder(store, { chats: luna }, name, parent);
      return saved.ok ? saved.data.id : '';
    };
    const top = await made('모험', null);
    const inner = await made('바다', top);
    const chat = async (character: string) => {
      const saved = await store.create('chat', { title: null, character, models: {} });
      return saved.ok ? saved.data.id : '';
    };
    const [kept, binned, theirs] = [await chat(luna), await chat(luna), await chat(mira)];
    await moveInto(store, 'chat', [kept, binned, theirs], inner);
    const folderOf = (id: string) => store.get('chat', id)!.value.folder;
    expect(folderOf(theirs)).toBeUndefined();
    // Past moveInto, as a write from an older version could have filed it.
    await store.update('chat', theirs, (current) => ({ ...current, folder: inner }));
    await removeChat(store, binned);

    expect(store.get('folder', inner)!.value).toEqual({ name: '바다', parent: top, of: 'chat', character: luna });
    const removal = folderRemoval(store, inner)!;
    expect([removal.kind, removal.up?.id, removal.placements.map(({ id }) => id).sort()]).toEqual(['chat', top, [kept, binned].sort()]);
    await removeFolder(store, removal);
    expect([folderOf(kept), folderOf(binned), folderOf(theirs)]).toEqual([top, top, inner]);
    await restoreFolder(store, removal);
    expect([folderOf(kept), folderOf(binned)]).toEqual([inner, inner]);

    await removeFolder(store, folderRemoval(store, top)!);
    expect('folder' in store.get('chat', kept)!.value).toBe(false);
  });

  it('leaves a thing moved elsewhere after the removal was decided where it went, on removal and on undo', async () => {
    const { store } = await server.account();
    const made = async (name: string, parent: string | null) => {
      const saved = await createFolder(store, 'persona', name, parent);
      return saved.ok ? saved.data.id : '';
    };
    const top = await made('판타지', null);
    const inner = await made('기사단', top);
    const away = await made('현대', null);
    const added = await addPersona(store, { name: '진', description: '', picture: null });
    const jin = added.ok ? added.data.id : '';
    await moveInto(store, 'persona', [jin], inner);

    const removal = folderRemoval(store, inner)!;
    await moveInto(store, 'persona', [jin], away);
    await removeFolder(store, removal);
    expect(store.get('persona', jin)!.value.folder).toBe(away);
    await restoreFolder(store, removal);
    expect(store.get('persona', jin)!.value.folder).toBe(away);
  });
});
