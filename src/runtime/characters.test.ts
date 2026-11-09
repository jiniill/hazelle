import { unavailableCalibration } from '../model/token-calibration';
import { serverBackend } from './backend';
import { describe, expect, it, vi } from 'vitest';
import type { Card, LoreEntry } from '../engine/import/types';
import { KEEP_DELETED, textTranslation, type Character, type Lore } from '../model/library';
import { cachePrintId } from '../model/cache';
import { memoryId } from '../model/memory';
import { likenessId } from '../model/likeness';
import { randomBytes } from '../vault/aead';
import { sealFile } from '../vault/files';
import { api, holdAccount } from './api';
import { addAssets, addCharacter, removeAssets, replaceAsset, restoreAssets, copyCharacter, createCharacter, illustrateSwitches, importCharacter, setIllustrate, setOwnIllustrate, pinToggle, setPinnedTogglesSpread, hideTool, setToolOrder, resetToggles, setAvatar, setDeleted, setOwnTranslate, setPictures, setTextTranslation, setToggle, setTranslate, translateSwitches } from './characters';
import { markDeleted, purgeExpired, purgeNow } from './removal';
import { createFolder } from './folders';
import { appendUserMessage, removeChat, restoreChat, startChat } from './chat-log';
import { Files } from './files';
import { thumbnail } from './picture';
import type { ObjectStore } from './store';
import { accountSettings } from './account-settings';
import type { Write } from './object-writes';
import { BATCH_LIMITS } from '../contracts/objects';
import { png, testServer } from './testing';
import { blankCard } from '../engine/import/card';

const server = testServer();
// The sweep a removal for good starts is runtime/files' to test.
const unswept = { sweep: async () => {} } as unknown as Files;
vi.mock('./picture', () => ({ thumbnail: vi.fn(async () => 'data:thumb') }));

// An MP4's box header naming its brand.
const mp4 = () => new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypisom'), ...randomBytes(16)]);
const picture = () => ({ bytes: randomBytes(64), type: 'image/png' });
const bare = (name: string, over: Partial<Character> = {}): Character => ({ card: blankCard(name), folder: null, loreFolders: [], ...over });
const none = { avatar: null, assets: [], lore: [], likeness: null };

async function savedChat(store: ObjectStore, character: string | null = null) {
  const id = crypto.randomUUID();
  await server.hold(store, id);
  await startChat(store, id, { title: null, character, models: {} }, null);
  await appendUserMessage(store, id, { id: crypto.randomUUID(), text: '안녕' });
  // The summary follows unawaited, and none is written while a later write to the chat is still pending.
  await store.projections.save(id);
  return id;
}

describe('importCharacter', () => {
  it('gives the lorebook folders ids, and each entry its folder by id', async () => {
    const { store, files } = await server.account();
    const entry = (name: string, folder: number | null) => ({ name, folder }) as LoreEntry;
    const saved = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [entry('등대', 1), entry('항구', null)], loreFolders: ['마을', '바다'], assets: [] }, null, () => {});
    const id = saved.ok ? saved.data.id : '';
    const character = store.get('character', id)!.value;
    expect(character.folder).toBeNull();
    expect(character.loreFolders.map((folder) => folder.name)).toEqual(['마을', '바다']);
    const folderOf = Object.fromEntries(store.children('lore', id).map((lore) => [lore.value.name, lore.value.folder]));
    expect(folderOf).toEqual({ 등대: character.loreFolders[1]!.id, 항구: null });
  });

  it('stores the picture and each asset a picture or video, once however often it appears, and counts the others', async () => {
    const { store, files } = await server.account();
    const [smile, clip, image] = [png(), mp4(), picture()];
    const assets = [
      { name: 'smile', read: async () => smile },
      { name: 'grin', read: async () => smile },
      { name: 'clip', read: async () => clip },
      { name: 'notes', read: async () => randomBytes(8) },
      { name: 'lost', read: async () => null },
    ];
    const steps: string[] = [];
    const saved = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [], loreFolders: [], assets }, image, (step) => steps.push(step.kind));
    expect(saved).toMatchObject({ ok: true, data: { unsupported: [{ kind: 'missing-asset', count: 1 }, { kind: 'unsupported-file', count: 1 }], faceless: false } });
    const id = saved.ok ? saved.data.id : '';
    const stored = store.children('asset', id).map(({ value }) => value);
    expect(stored.map(({ name, type, size }) => [name, type, size])).toEqual([
      ['smile', 'image/png', smile.length],
      ['grin', 'image/png', smile.length],
      ['clip', 'video/mp4', clip.length],
    ]);
    expect(stored[0]!.file).toEqual(stored[1]!.file);
    expect(await files.read(stored[0]!.file)).toEqual({ ok: true, data: smile });
    const avatar = store.children('avatar', id)[0]!.value;
    expect(await files.read(avatar.file)).toEqual({ ok: true, data: image.bytes });
    expect(new Set(steps)).toEqual(new Set(['picture', 'assets', 'saving']));
  });

  it('leaves out a picture the operator blocked or a video past the picture cap, counted, and keeps the rest of the bot', async () => {
    const { store } = await server.account();
    const [blocked, over, kept] = [png(), mp4(), png()];
    const refusals = new Map([[(await sealFile(blocked)).ref.id, 'file-blocked'], [(await sealFile(over)).ref.id, 'files-full']]);
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => {
      const error = args[0] === 'PUT' ? refusals.get(args[1].slice('files/'.length)) : undefined;
      return error ? { ok: false as const, error } : api<T>(...args);
    }), store);
    const assets = [
      { name: 'taken', read: async () => blocked },
      { name: 'over', read: async () => over },
      { name: 'smile', read: async () => kept },
    ];
    const saved = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [], loreFolders: [], assets }, null, () => {});
    expect(saved).toMatchObject({ ok: true, data: { unsupported: [{ kind: 'refused-picture', count: 1 }, { kind: 'refused-video', count: 1 }] } });
    expect(store.children('asset', saved.ok ? saved.data.id : '').map(({ value }) => value.name)).toEqual(['smile']);
  });

  it('owns thumbnail failures and upload refusals in faceless while an absent source picture is not a failure', async () => {
    const { store, files } = await server.account();
    const card = { card: blankCard('루나'), lore: [], loreFolders: [], assets: [] };
    const missing = await importCharacter(store, files, card, null, () => {});
    expect(missing).toMatchObject({ ok: true, data: { faceless: false } });

    vi.mocked(thumbnail).mockRejectedValueOnce(new Error('unreadable picture'));
    const unreadable = await importCharacter(store, files, card, picture(), () => {});
    expect(unreadable).toMatchObject({ ok: true, data: { faceless: true } });
    const refused = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => args[0] === 'PUT' ? { ok: false as const, error: 'too-large' } : api<T>(...args)), store);
    expect(await importCharacter(store, refused, card, picture(), () => {})).toMatchObject({ ok: true, data: { faceless: true } });
    expect(store.list('avatar')).toEqual([]);
    expect(store.list('character')).toHaveLength(3);
  });
});

describe('createCharacter', () => {
  it('shows the blank character under its id before the write is answered, so its page opens at once, dated for 최근', async () => {
    const { store } = await server.account();
    const id = crypto.randomUUID();
    const saving = createCharacter(store, '새 캐릭터', id);
    expect(store.get('character', id)?.value).toEqual({ ...bare('새 캐릭터'), changed: expect.any(Number) });
    expect(await saving).toEqual({ ok: true, data: id });
  });
});

describe('setAvatar', () => {
  it('rewrites a copy’s avatar in place while the original keeps the file they shared, and gives one to a character without', async () => {
    const { store, files } = await server.account();
    const card = { card: blankCard('루나'), lore: [], loreFolders: [], assets: [] };
    const first = picture();
    const imported = await importCharacter(store, files, card, first, () => {});
    const original = imported.ok ? imported.data.id : '';
    const copied = await copyCharacter(store, original, '루나 2', () => {});
    const copy = copied.ok ? copied.data : '';
    const [held] = store.children('avatar', copy);
    const next = png();
    vi.mocked(thumbnail).mockResolvedValueOnce('data:next');
    expect(await setAvatar(store, files, copy, next)).toMatchObject({ ok: true, data: { id: held!.id, value: { type: 'image/png', size: next.length, thumb: 'data:next' } } });
    const [changed, ...more] = store.children('avatar', copy);
    expect(more).toEqual([]);
    expect(await files.read(changed!.value.file)).toEqual({ ok: true, data: next });
    const kept = store.children('avatar', original)[0]!.value;
    expect(kept).toEqual(held!.value);
    expect(await files.read(kept.file)).toEqual({ ok: true, data: first.bytes });

    const faceless = await importCharacter(store, files, card, null, () => {});
    const id = faceless.ok ? faceless.data.id : '';
    expect(await setAvatar(store, files, id, randomBytes(64))).toEqual({ ok: false, error: 'picture-unreadable' });
    const given = await setAvatar(store, files, id, next);
    expect(given.ok && given.data.parent).toBe(id);
    expect(store.children('avatar', id).map(({ value }) => value.file)).toEqual([changed!.value.file]);
  });

  it('answers a refused upload as picture-refused and leaves the avatar as it was', async () => {
    const { store, files } = await server.account();
    const imported = await importCharacter(store, files, { card: blankCard('루나'), lore: [], loreFolders: [], assets: [] }, picture(), () => {});
    const id = imported.ok ? imported.data.id : '';
    const before = store.children('avatar', id);
    const refused = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => args[0] === 'PUT' ? { ok: false as const, error: 'files-full' } : api<T>(...args)), store);
    expect(await setAvatar(store, refused, id, png())).toEqual({ ok: false, error: 'picture-refused' });
    expect(store.children('avatar', id)).toEqual(before);
  });
});

describe('addAssets', () => {
  it('stores each picked picture under its file name without the extension, and counts a file that is no picture', async () => {
    const { store, files } = await server.account();
    const imported = await importCharacter(store, files, { card: blankCard('루나'), lore: [], loreFolders: [], assets: [] }, null, () => {});
    const id = imported.ok ? imported.data.id : '';
    const smile = png();
    expect(await addAssets(store, files, id, [new File([smile], 'smile.happy.png'), new File([randomBytes(16)], 'notes.txt')])).toEqual({ ok: true, data: { added: 1, unsupported: [{ kind: 'unsupported-file', count: 1 }] } });
    const [asset, ...more] = store.children('asset', id);
    expect(more).toEqual([]);
    expect(asset!.value).toMatchObject({ name: 'smile.happy', type: 'image/png', size: smile.length });
    expect(await files.read(asset!.value.file)).toEqual({ ok: true, data: smile });
  });

  it('stores emotion images as their own use, pictures only', async () => {
    const { store, files } = await server.account();
    const imported = await importCharacter(store, files, { card: blankCard('루나'), lore: [], loreFolders: [], assets: [] }, null, () => {});
    const id = imported.ok ? imported.data.id : '';
    expect(await addAssets(store, files, id, [new File([png()], 'joy.png'), new File([mp4()], 'dance.mp4')], 'emotion')).toEqual({ ok: true, data: { added: 1, unsupported: [{ kind: 'unsupported-file', count: 1 }] } });
    const [joy] = store.children('asset', id);
    expect(joy!.value).toMatchObject({ name: 'joy', type: 'image/png', use: 'emotion' });
    expect(await replaceAsset(store, files, joy!.id, mp4())).toEqual({ ok: false, error: 'picture-unreadable' });
  });

  it('removes several assets in one write and brings them back as they were', async () => {
    const { store, files } = await server.account();
    const imported = await importCharacter(store, files, { card: blankCard('루나'), lore: [], loreFolders: [], assets: [] }, null, () => {});
    const id = imported.ok ? imported.data.id : '';
    await addAssets(store, files, id, [new File([png()], 'a.png'), new File([png()], 'b.png'), new File([png()], 'c.png')]);
    const before = store.children('asset', id);
    const removed = await removeAssets(store, before.slice(0, 2).map(({ id }) => id));
    expect(store.children('asset', id).map(({ value }) => value.name)).toEqual([before[2]!.value.name]);
    expect(await restoreAssets(store, removed.ok ? removed.data : [])).toEqual({ ok: true, data: null });
    expect(store.children('asset', id).map(({ id, value }) => ({ id, value })).toSorted((a, b) => a.value.name.localeCompare(b.value.name))).toEqual(before.map(({ id, value }) => ({ id, value })).toSorted((a, b) => a.value.name.localeCompare(b.value.name)));
  });

  it('replaces an asset’s picture under the same id and name, and leaves it as it was for a file that is no picture', async () => {
    const { store, files } = await server.account();
    const imported = await importCharacter(store, files, { card: blankCard('루나'), lore: [], loreFolders: [], assets: [] }, null, () => {});
    const id = imported.ok ? imported.data.id : '';
    await addAssets(store, files, id, [new File([png()], 'smile.png')]);
    const [held] = store.children('asset', id);
    expect(await replaceAsset(store, files, held!.id, randomBytes(16))).toEqual({ ok: false, error: 'picture-unreadable' });
    const next = png();
    expect(await replaceAsset(store, files, held!.id, next)).toMatchObject({ ok: true, data: { id: held!.id, value: { name: 'smile', size: next.length } } });
    expect(await files.read(store.children('asset', id)[0]!.value.file)).toEqual({ ok: true, data: next });
  });
});

describe('addCharacter', () => {
  it('sends a batch over one request with its chat roots in the character’s request', async () => {
    const { store } = await server.account();
    const id = crypto.randomUUID();
    const roots = Array.from({ length: 2 }, (): Write => ({ type: 'create', kind: 'chat', id: crypto.randomUUID(), parent: null, value: { title: null, character: id, models: {} } }));
    const lore = Array.from({ length: BATCH_LIMITS.items - roots.length }, (_, index) => ({ name: `lore ${index}` }) as Lore);
    const requests = vi.spyOn(globalThis, 'fetch');
    expect((await addCharacter(store, bare('루나'), { ...none, lore }, () => {}, { id, chats: roots })).ok).toBe(true);
    const batches = requests.mock.calls.filter(([url]) => url === '/api/objects/batch').map(([, init]) => (JSON.parse(init!.body as string) as { writes: { id: string }[] }).writes.map((write) => write.id));
    expect(batches).toHaveLength(2);
    expect(batches.at(-1)!.slice(-3)).toEqual([...roots.map((root) => root.id), id]);
  });
});

describe('copyCharacter', () => {
  it('copies the card under its new name with the lorebook, the picture and the 삽화 profiles, and remembers the origin', async () => {
    const { store, files } = await server.account();
    const luna: Character = { card: { name: '루나' } as Card, folder: 'f', loreFolders: [{ id: 'town', name: '마을' }] };
    const entry = { name: '등대', content: '폭풍 치는 밤의 등대', folder: 'town' } as Lore;
    const saved = await importCharacter(store, files, { card: luna.card, lore: [], loreFolders: [], assets: [{ name: 'smile', read: async () => png() }] }, picture(), () => {});
    const imported = saved.ok ? saved.data.id : '';
    const [avatar] = store.children('avatar', imported).map(({ value }) => value);
    const assets = store.children('asset', imported).map(({ value }) => value);
    const likeness = { portraits: [{ name: '루나', aliases: [], look: 'girl', outfits: [], artist: '', source: 'text' as const }], at: 1, receipt: null };
    const original = await addCharacter(store, luna, { avatar: avatar!, assets, lore: [entry], likeness }, () => {});
    const id = original.ok ? original.data : '';

    const copied = await copyCharacter(store, id, '루나 (사본)', () => {});
    const copy = copied.ok ? copied.data : '';
    expect(store.get('character', copy)?.value).toEqual({ ...luna, card: { ...luna.card, name: '루나 (사본)' }, origin: { id, name: '루나' }, changed: expect.any(Number) });
    expect(store.children('lore', copy).map((lore) => lore.value)).toEqual([entry]);
    expect(store.children('avatar', copy).map(({ value }) => value)).toEqual([avatar]);
    expect(store.children('asset', copy).map(({ value }) => value)).toEqual(assets);
    expect(store.get('likeness', likenessId(copy))).toMatchObject({ parent: copy, value: likeness });
  });
});

describe('purgeExpired', () => {
  it('removes a character deleted a week ago with everything it owns, and keeps one deleted since', async () => {
    const { store, files } = await server.account();
    const now = Date.now();
    const saved = await importCharacter(store, files, { card: blankCard('old'), lore: [{ name: 'lore', folder: null } as LoreEntry], loreFolders: [], assets: [{ name: 'smile', read: async () => png() }] }, picture(), () => {});
    const expired = saved.ok ? saved.data.id : '';
    await setDeleted(store, expired, now - KEEP_DELETED);
    await addCharacter(store, bare('recent', { deleted: now - 1000 }), none, () => {});
    const chat = await store.create('chat', { title: null, character: expired, models: {} });
    await store.create('entry', { type: 'message', role: 'user', at: now, text: '안녕', receipt: null }, { parent: chat.ok ? chat.data.id : '' });

    await server.hold(store, chat.ok ? chat.data.id : '');
    await purgeExpired(store, unswept, now, new AbortController().signal);
    expect(store.list('character').map((kept) => kept.value.card.name)).toEqual(['recent']);
    expect([store.list('chat'), store.children('entry', chat.ok ? chat.data.id : ''), store.list('lore'), store.list('avatar'), store.list('asset')].map((left) => left.length)).toEqual([0, 0, 0, 0, 0]);
  });

  it('leaves a character another device brought back since this one listed it, with its chats', async () => {
    const { store, open } = await server.account();
    const now = Date.now();
    const added = await addCharacter(store, bare('루나', { deleted: now - KEEP_DELETED }), none, () => {});
    const id = added.ok ? added.data : '';
    const chat = await store.create('chat', { title: null, character: id, models: {} });
    const other = await open();
    await other.pull();
    await setDeleted(other, id, null);

    await purgeExpired(store, unswept, now, new AbortController().signal);
    expect([store.get('character', id)?.value.deleted, store.get('chat', chat.ok ? chat.data.id : '')?.id]).toEqual([undefined, chat.ok ? chat.data.id : '']);
  });

  it('removes a prompt deleted a week ago and keeps a persona deleted since', async () => {
    const { store } = await server.account();
    const now = Date.now();
    const prompt = await store.create('prompt', { name: '옛', blocks: [], toggles: [], authorNote: '', models: {}, deleted: now - KEEP_DELETED });
    await store.create('persona', { name: '린', description: '', picture: null, deleted: now - 1000 });

    await purgeExpired(store, unswept, now, new AbortController().signal);
    expect([store.get('prompt', prompt.ok ? prompt.data.id : ''), store.list('persona').map(({ value }) => value.name)]).toEqual([null, ['린']]);
  });

  it('finishes a removal begun before, however long the character has left', async () => {
    const { store } = await server.account();
    const now = Date.now();
    await addCharacter(store, bare('루나', { deleted: now, purging: true }), { ...none, lore: [{ name: 'lore' } as Lore] }, () => {});

    await purgeExpired(store, unswept, now, new AbortController().signal);
    expect([store.list('character'), store.list('lore')].map((left) => left.length)).toEqual([0, 0]);
  });

  it('removes a chat deleted a week ago with all it owns (its cache print too), which the account no longer counts, and keeps one deleted since', async () => {
    const { accountId, store, files } = await server.account();
    let bytes = 0;
    holdAccount(accountId, (heard) => { if (heard.kind === 'bytes') bytes = heard.bytes; });
    const expired = await savedChat(store);
    await store.create('memory', { records: [], chapters: [], state: [], threads: [{ id: 't', text: '등대', opened: null }] }, { id: memoryId(expired), parent: expired });
    await store.create('cacheprint', { call: 'r', connection: 'c', account: null, model: 'm', messages: [{ role: 'user', hash: 'h', tokens: 1, from: { kind: 'block', name: null, slot: 'chat' }, point: true }] }, { id: cachePrintId(expired), parent: expired });
    await store.create('stream', { calibration: unavailableCalibration('historical'), key: {}, call: { connection: 'c', source: 'c', model: 'm', modelName: 'm' }, at: 0, result: 'r', for: { kind: 'reply', message: null, replaces: null, continues: null } }, { parent: expired });
    const scene = { paragraph: 0, shape: 'square' as const, setting: '', framing: '', characters: [] };
    const saved = await files.save([new Uint8Array(1)]);
    if (!saved.ok) throw new Error(saved.error);
    await store.create('illustration', { message: 'm', version: 'v', scene, receipt: null, model: { connection: 'c', model: 'm' }, sent: { prompt: '', negative: '', characters: [], width: 1024, height: 1024, seed: 1 }, file: saved.data[0]!, type: 'image/png', size: 1, at: 0 }, { parent: expired });
    await removeChat(store, expired);
    const now = Date.now() + KEEP_DELETED;
    const recent = await savedChat(store);
    await markDeleted(store, 'chat', recent, now);
    const owned = (chat: string) => (['entry', 'summary', 'memory', 'cacheprint', 'stream', 'illustration'] as const).flatMap((kind) => store.children(kind, chat)).length;
    expect(owned(expired)).toBe(6);
    const before = bytes;

    await purgeExpired(store, unswept, now, new AbortController().signal);
    expect([store.list('chat').map(({ id }) => id), owned(expired), owned(recent)]).toEqual([[recent], 0, 2]);
    expect(bytes).toBeLessThan(before);
  });

  it('finishes a chat’s removal cut short, which can no longer be brought back', async () => {
    const { store } = await server.account();
    const chat = await savedChat(store);
    await removeChat(store, chat);
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url === '/api/objects/batch' && (JSON.parse(init?.body as string) as { writes: { id: string; body: string | null }[] }).writes.some((write) => write.id === chat && write.body === null) ? Promise.resolve(Response.json({ error: 'server-error' }, { status: 500 })) : real(url, init)));
    await purgeExpired(store, unswept, Date.now() + KEEP_DELETED, new AbortController().signal);
    expect([store.get('chat', chat)?.value.purging, store.children('entry', chat).length]).toEqual([true, 0]);
    expect(await restoreChat(store, chat)).toEqual({ ok: false, error: 'gone' });

    vi.stubGlobal('fetch', real);
    await purgeExpired(store, unswept, Date.now(), new AbortController().signal);
    expect(store.list('chat')).toEqual([]);
  });
});

describe('setToggle', () => {
  it('keeps values per character and for 캐릭터 없이, and resetToggles drops a character’s', async () => {
    const { store } = await server.account();
    const added = await addCharacter(store, bare('루나'), none, () => {});
    const id = added.ok ? added.data : '';
    await setToggle(store, id, 'sims', '1');
    await setToggle(store, id, 'mode', '2');
    await setToggle(store, null, 'sims', '0');
    expect([store.get('character', id)?.value.toggles, accountSettings(store).toggles]).toEqual([{ sims: '1', mode: '2' }, { sims: '0' }]);
    await resetToggles(store, id);
    expect(store.get('character', id)?.value.toggles).toBeUndefined();
  });
});

describe('setPinnedTogglesSpread', () => {
  it('stores the spread layout and drops the field for the gathered one', async () => {
    const { store } = await server.account();
    await setPinnedTogglesSpread(store, true);
    expect(accountSettings(store).pinnedTogglesSpread).toBe(true);
    await setPinnedTogglesSpread(store, false);
    expect(accountSettings(store)).not.toHaveProperty('pinnedTogglesSpread');
  });
});

describe('hideTool', () => {
  it('lists a hidden tool and drops the field when none is left', async () => {
    const { store } = await server.account();
    await hideTool(store, 'note', true);
    expect(accountSettings(store).hiddenTools).toEqual(['note']);
    await hideTool(store, 'note', false);
    expect(accountSettings(store)).not.toHaveProperty('hiddenTools');
  });
});

describe('setToolOrder', () => {
  it('reorders this chat\'s tools and leaves a plugin only other chats have in its slot', async () => {
    const { store } = await server.account();
    await setToolOrder(store, ['note', 'elsewhere', 'attach']);
    await setToolOrder(store, ['attach', 'note']);
    expect(accountSettings(store).toolOrder).toEqual(['attach', 'elsewhere', 'note']);
  });
});

describe('pinToggle', () => {
  it('keeps pinned keys in pin order, once each, and drops the field with the last', async () => {
    const { store } = await server.account();
    await pinToggle(store, 'sims', true);
    await pinToggle(store, 'mode', true);
    await pinToggle(store, 'sims', true);
    expect(accountSettings(store).pinnedToggles).toEqual(['mode', 'sims']);
    await pinToggle(store, 'mode', false);
    await pinToggle(store, 'sims', false);
    expect(accountSettings(store)).not.toHaveProperty('pinnedToggles');
  });
});

describe('setTextTranslation', () => {
  it('keeps one per text and language, and drops those of texts the card no longer holds', async () => {
    const { store } = await server.account();
    const added = await addCharacter(store, { ...bare('루나'), card: { ...blankCard('루나'), description: 'Old', greetings: ['Hello'] } }, none, () => {});
    const id = added.ok ? added.data : '';
    const made = (text: string) => ({ text, receipt: null, at: 1 });
    await setTextTranslation(store, id, 'Old', 'Korean', made('옛'));
    await setTextTranslation(store, id, 'Hello', 'Korean', made('안녕'));
    await setTextTranslation(store, id, 'Hello', 'Korean', made('안녕하세요'));
    await store.update('character', id, (current) => ({ ...current, card: { ...current.card, description: 'New' } }));
    await setTextTranslation(store, id, 'New', 'Korean', made('새'));
    expect(store.get('character', id)!.value.translations!.map(({ source, translation }) => [source, translation.text])).toEqual([
      ['Hello', '안녕하세요'],
      ['New', '새'],
    ]);
    expect(textTranslation(store.get('character', id)!.value, 'Hello', 'Japanese')).toBeUndefined();
  });
});

describe('setPictures', () => {
  it('merges the fields given, and a field set back to its default leaves nothing stored', async () => {
    const { store } = await server.account();
    const added = await addCharacter(store, bare('루나'), none, () => {});
    const id = added.ok ? added.data : '';
    await setPictures(store, id, { peek: 30 });
    await setPictures(store, id, { fold: false, widest: 90 });
    expect(store.get('character', id)?.value.pictures).toEqual({ peek: 30, fold: false, widest: 90 });
    await setPictures(store, id, { peek: undefined, fold: undefined, widest: undefined });
    expect(store.get('character', id)?.value).not.toHaveProperty('pictures');
  });
});

describe('purgeNow', () => {
  it('leaves the character in place when a removal fails midway, past bringing back, and finishes when tried again', async () => {
    const { store, open } = await server.account();
    const added = await addCharacter(store, bare('루나', { deleted: Date.now() }), { ...none, lore: [{ name: 'lore' } as Lore] }, () => {});
    const id = added.ok ? added.data : '';
    const chat = await store.create('chat', { title: null, character: id, models: {} });
    const chatId = chat.ok ? chat.data.id : '';
    await store.create('entry', { type: 'message', role: 'user', at: 1, text: '안녕', receipt: null }, { parent: chatId });

    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => (url === '/api/objects/batch' && (JSON.parse(init?.body as string) as { writes: { id: string; body: string | null }[] }).writes.some((write) => write.id === chatId && write.body === null) ? Promise.resolve(Response.json({ error: 'server-error' }, { status: 500 })) : real(url, init)));
    expect(await purgeNow(store, unswept, 'character', id, () => {})).toEqual({ ok: false, error: 'server-error' });
    const other = await open();
    await other.pull();
    expect([other.get('character', id), other.get('chat', chatId)].map((kept) => kept?.id)).toEqual([id, chatId]);
    await server.hold(other, chatId);
    expect([other.children('entry', chatId), other.list('lore')].map((left) => left.length)).toEqual([0, 0]);
    expect(await setDeleted(other, id, null)).toEqual({ ok: false, error: 'gone' });

    vi.stubGlobal('fetch', real);
    const steps: [number, number][] = [];
    expect(await purgeNow(store, unswept, 'character', id, (removed, total) => steps.push([removed, total]))).toEqual({ ok: true, data: null });
    expect(steps).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect([store.list('character'), store.list('chat')].map((left) => left.length)).toEqual([0, 0]);
  });

  it("takes its chat folders with it, and leaves another's and 캐릭터 없이's", async () => {
    const { store } = await server.account();
    const [gone, other] = await Promise.all([addCharacter(store, bare('루나', { deleted: Date.now() }), none, () => {}), addCharacter(store, bare('미라'), none, () => {})]);
    const [id, kept] = [gone.ok ? gone.data : '', other.ok ? other.data : ''];
    for (const character of [id, kept, null]) await createFolder(store, { chats: character }, '모험', null);

    expect(await purgeNow(store, unswept, 'character', id, () => {})).toEqual({ ok: true, data: null });
    expect(store.list('folder').map(({ value }) => value.of === 'chat' && value.character)).toEqual([kept, null]);
  });

  it('takes its deleted chats with it, their messages included', async () => {
    const { store } = await server.account();
    const added = await addCharacter(store, bare('루나', { deleted: Date.now() }), none, () => {});
    const id = added.ok ? added.data : '';
    const chat = await savedChat(store, id);
    await removeChat(store, chat);

    expect(await purgeNow(store, unswept, 'character', id, () => {})).toEqual({ ok: true, data: null });
    expect([store.list('chat'), store.children('entry', chat)].map((left) => left.length)).toEqual([0, 0]);
  });

  it('removes a deleted chat with its messages and leaves its character, and refuses a chat not deleted', async () => {
    const { store } = await server.account();
    const added = await addCharacter(store, bare('루나'), none, () => {});
    const id = added.ok ? added.data : '';
    const [binned, kept] = [await savedChat(store, id), await savedChat(store, id)];
    await removeChat(store, binned);

    expect(await purgeNow(store, unswept, 'chat', kept, () => {})).toEqual({ ok: false, error: 'gone' });
    expect(await purgeNow(store, unswept, 'chat', binned, () => {})).toEqual({ ok: true, data: null });
    expect([store.list('chat').map((chat) => chat.id), store.children('entry', binned).length, store.get('character', id)?.id]).toEqual([[kept], 0, id]);
  });
});

describe('translation switches', () => {
  it('are shared by every chat, except a character’s own once 이 캐릭터만 따로 is on', async () => {
    const { store } = await server.account();
    const [luna, sol] = await Promise.all([store.create('character', bare('루나')), store.create('character', bare('솔'))]).then((made) => made.map((each) => (each.ok ? each.data.id : '')));

    await setTranslate(store, luna!, { replies: true });
    expect([translateSwitches(store, sol!), translateSwitches(store, null)]).toMatchObject([{ replies: true, own: false }, { replies: true, own: false }]);
    await setOwnTranslate(store, luna!, true);
    await setTranslate(store, luna!, { replies: false });
    expect([translateSwitches(store, luna!), translateSwitches(store, sol!)]).toMatchObject([{ replies: false, own: true }, { replies: true, own: false }]);
    await setOwnTranslate(store, luna!, false);
    expect(translateSwitches(store, luna!)).toMatchObject({ replies: true, own: false });
  });
});

describe('삽화 switches', () => {
  it('start with auto and spend off, are shared by every chat and 캐릭터 없이, and a character’s own replaces them while on', async () => {
    const { store } = await server.account();
    const [luna, sol] = await Promise.all([store.create('character', bare('루나')), store.create('character', bare('솔'))]).then((made) => made.map((each) => (each.ok ? each.data.id : '')));
    expect([illustrateSwitches(store, luna!), illustrateSwitches(store, null)]).toEqual([{ auto: false, spend: false, ladder: [], pov: false, comic: false, own: false }, { auto: false, spend: false, ladder: [], pov: false, comic: false, own: false }]);

    const model = { connection: 'c', model: 'nai-diffusion-5' };
    await setIllustrate(store, luna!, { auto: true, spend: false, model });
    expect([illustrateSwitches(store, sol!), illustrateSwitches(store, null)]).toEqual([{ auto: true, spend: false, ladder: [], pov: false, comic: false, model, own: false }, { auto: true, spend: false, ladder: [], pov: false, comic: false, model, own: false }]);
    await setOwnIllustrate(store, luna!, true);
    await setIllustrate(store, luna!, { prompt: 'p', model: undefined });
    expect([illustrateSwitches(store, luna!), illustrateSwitches(store, sol!)]).toEqual([{ auto: true, spend: false, ladder: [], pov: false, comic: false, prompt: 'p', own: true }, { auto: true, spend: false, ladder: [], pov: false, comic: false, model, own: false }]);
    await setOwnIllustrate(store, luna!, false);
    expect(illustrateSwitches(store, luna!)).toEqual({ auto: true, spend: false, ladder: [], pov: false, comic: false, model, own: false });
  });
});
