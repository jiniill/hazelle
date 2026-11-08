import { describe, expect, it } from 'vitest';
import { blankCard } from '../../engine/import/card';
import type { ImportedModule } from '../../engine/import/types';
import type { ChatFile } from '../chat-file';
import { accountSettings } from '../account-settings';
import { modulesOf } from '../modules';
import { testServer } from '../testing';
import { ImportReadError } from './protocol';
import { chatDestination, placeOn, saveModule } from './save';

const server = testServer();

const bell = (name: string): ImportedModule => ({ name, description: '', namespace: 'bell', risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] });
const unread = () => Promise.reject(new ImportReadError('closed'));
const chats = (character: ChatFile['character']) => ({ ok: true as const, chat: { character } as ChatFile });

describe('import save', () => {
  it('replaces the live versions of its namespace, and undoing brings them back on where they were', async () => {
    const { store, files } = await server.account();
    const old = await saveModule({ store, files }, bell('Bell 1'), false, { kind: 'always' }, unread, () => {});
    if (!old.ok) throw new Error(old.error);
    const saved = await saveModule({ store, files }, bell('Bell 2'), true, null, unread, () => {});
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data).toMatchObject({ placed: null, replaced: { places: { ok: true, data: 1 } }, kept: null });
    expect(modulesOf(store).map(({ value }) => value.name)).toEqual(['Bell 2']);

    expect((await saved.data.undo()).ok).toBe(true);
    expect(modulesOf(store).map(({ value }) => value.name)).toEqual(['Bell 1']);
    expect(accountSettings(store).modules).toContain(old.data.id);
  });

  it('sends chats where the way in named, else to their own character, else to the page\'s, else asks', async () => {
    const { store } = await server.account();
    const made = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] });
    if (!made.ok) throw new Error(made.error);
    const luna = made.data.id;
    const page = placeOn(store, { kind: 'character', id: luna });
    expect(chatDestination(store, chats({ id: 'gone', name: '루나' }), null, page)).toEqual({ asked: false, name: null, picked: null });
    expect(chatDestination(store, chats({ id: luna, name: '루나' }), undefined, null)).toEqual({ asked: false, name: null, picked: luna });
    expect(chatDestination(store, chats(null), undefined, page)).toEqual({ asked: false, name: null, picked: luna });
    expect(chatDestination(store, chats(null), undefined, null)).toEqual({ asked: true, name: null, picked: null });
    expect(chatDestination(store, chats({ id: 'gone', name: '루나' }), undefined, null)).toEqual({ asked: true, name: '루나', picked: luna });
  });
});
