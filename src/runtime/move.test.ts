import { describe, expect, it, vi } from 'vitest';
import { serverBackend } from './backend';
import type { Inlays } from '../engine/import/backup';
import { convertPreset } from '../engine/import/preset';
import type { Card, ImportedModule, RisuBackup, RisuCharacter, RisuPersona, RisuPreset } from '../engine/import/types';
import { fold, shown } from '../model/chat';
import { accountSettings } from './account-settings';
import { randomBytes } from '../vault/aead';
import { sealFile } from '../vault/files';
import { api } from './api';
import { importCharacter, setToggle } from './characters';
import { setSharedLoreScan, sharedLoreScan } from './chat-context';
import { Files } from './files';
import { MEMORY_DEFAULTS } from './memory-read';
import { broughtFromRisu, fillInlays, fillPictures, importRisuChats, moveFromRisu, risuMatch, type MoveStep } from './move';
import { setModuleAlways } from './modules';
import { addPersona, setCurrentPersona } from './personas';
import { png, testServer } from './testing';
import { blankCard } from '../engine/import/card';
import { summaryId, summaryStale } from './summary';

const server = testServer();


const luna: RisuCharacter = {
  id: 'risu-luna',
  card: { ...blankCard('루나'), greetings: ['', '첫 인사', '둘째 인사'] },
  lore: [],
  loreFolders: [],
  assets: [],
  report: { format: 'json', spec: 'v3', unsupported: [] },
  own: null,
  avatar: async () => null,
  folder: '모험',
  chats: [
    {
      title: '등대',
      note: '비가 온다',
      persona: 'risu-jin',
      greeting: 2,
      variables: [['hp', '7']],
      inlays: [],
      lore: [],
      loreFolders: [],
      memory: [],
      messages: [
        { role: 'user', text: '안녕', at: 1 },
        { role: 'assistant', text: '반가워 [HP 7]', at: 2 },
      ],
    },
  ],
  modules: [],
  missed: [],
};

const bell: ImportedModule = {
  name: 'Bell',
  description: '',
  namespace: null,
  risu: 'risu-bell',
  pack: { regex: [], triggers: [], toggles: [] },
  lore: [],
  loreFolders: [],
  assets: [
    { name: 'ring', read: async () => png() },
    { name: 'notes', read: async () => randomBytes(8) },
  ],
  unsupported: [],
};

function source({ characters, personas = [], presets = [], modules = [], alwaysModules = [], loreBudget = null, toggles = {} }: { characters: RisuCharacter[]; personas?: RisuPersona[]; presets?: RisuPreset[]; modules?: ImportedModule[]; alwaysModules?: string[]; loreBudget?: number | null; toggles?: Record<string, string> }): RisuBackup {
  return {
    catalog: {
      pictures: 0,
      pictureBytes: 0,
      characters: characters.map((character, key) => ({ key, id: character.id, name: character.card.name, chatCount: character.chats.length, assetCount: character.assets.length, inlayCount: character.chats.reduce((sum, chat) => sum + chat.inlays.length, 0), lastTalk: character.chats.reduce((at, chat) => Math.max(at, chat.messages.at(-1)?.at ?? 0), 0) })),
      personas: personas.map(({ name, alias }, key) => ({ key, name, alias, selected: key === 0 })),
      presets: presets.map(({ name, result }, key) => ({ key, name, failure: result.ok ? null : result.failure.kind })),
      modules: modules.map(({ name, risu, assets }, key) => ({ key, name, risu, assetCount: assets.length })),
      alwaysModules, loreBudget, toggles, unsupported: [],
    },
    character: vi.fn(async (key) => characters[key]!),
    persona: async (key) => personas[key]!,
    preset: async (key) => presets[key]!,
    module: async (key) => modules[key]!,
  };
}

describe('moveFromRisu', () => {
  it('brings a character whole, its chat on the greeting Risu showed with its messages staged and its persona, and a second run skips it', async () => {
    const { store, files } = await server.account();
    const backup = source({ characters: [luna, { ...luna, id: 'unselected' }], personas: [{ id: 'risu-jin', name: '진', alias: '부자', description: '여행자', picture: async () => null, module: null }] });
    const pick = { ...backup.catalog, characters: [backup.catalog.characters[0]!] };
    const moved = await moveFromRisu(store, files, backup, pick, null, () => {});
    expect(moved).toMatchObject({ ok: true, data: { personas: 1, prompts: 0, modules: [], characters: [{ risu: 'risu-luna', name: '루나', chats: 1 }] } });
    const id = moved.ok ? moved.data.characters[0]!.id : '';
    const [folder] = store.list('folder');
    expect(store.get('character', id)!.value).toMatchObject({ risu: 'risu-luna', folder: folder!.id });
    expect(store.get('character', id)!.value).not.toHaveProperty('modules');
    expect(folder!.value).toEqual({ name: '모험' });

    const [chat] = store.list('chat');
    const jin = store.list('persona').find(({ value }) => value.name === '진' && value.alias === '부자')!.id;
    expect(chat!.value).toEqual({ title: '등대', character: id, models: {}, memory: { ...MEMORY_DEFAULTS, on: false }, note: '비가 온다', persona: jin, variables: [['hp', '7']] });
    await server.hold(store, chat!.id);
    const messages = fold(store.children('entry', chat!.id));
    expect(messages.map((message) => [message.role, shown(message).text, shown(message).staged])).toEqual([
      ['assistant', '둘째 인사', undefined],
      ['user', '안녕', true],
      ['assistant', '반가워 [HP 7]', true],
    ]);
    expect(messages[0]!.versions).toHaveLength(2);
    expect(shown(messages[0]!).greeting).toBe(2);
    expect(risuMatch(store, '루나')).toBe(id);

    expect(await moveFromRisu(store, files, backup, { ...pick, personas: [] }, null, () => {})).toEqual({ ok: true, data: { characters: [], personas: 0, prompts: 0, modules: [], loreBudget: null, toggles: 0 } });
    expect(backup.character).toHaveBeenCalledExactlyOnceWith(0);
    expect(store.list('character')).toHaveLength(1);
    expect(broughtFromRisu(store)).toEqual(new Set(['risu-luna']));
  });

  it('opens a chat whose greeting lies past the card\'s on its last one', async () => {
    const { store, files } = await server.account();
    const backup = source({ characters: [{ ...luna, chats: [{ ...luna.chats[0]!, greeting: 5 }] }] });
    await moveFromRisu(store, files, backup, backup.catalog, null, () => {});
    const [chat] = store.list('chat');
    await server.hold(store, chat!.id);
    const [greeting] = fold(store.children('entry', chat!.id));
    expect([shown(greeting!).text, shown(greeting!).greeting]).toEqual(['둘째 인사', 2]);
  });

  it('gives a chat Risu bound to no persona the current one', async () => {
    const { store, files } = await server.account();
    const current = await addPersona(store, { name: '진', description: '', picture: null });
    await setCurrentPersona(store, current.ok ? current.data.id : '');
    const backup = source({ characters: [{ ...luna, chats: [{ ...luna.chats[0]!, persona: null }] }] });
    await moveFromRisu(store, files, backup, backup.catalog, null, () => {});
    expect(store.list('chat')[0]!.value.persona).toBe(current.ok && current.data.id);
  });

  it("makes the persona Risu had selected the current one, which a chat Risu bound to no persona then holds", async () => {
    const { store, files } = await server.account();
    const persona = (name: string): RisuPersona => ({ id: name, name, alias: '', description: name, picture: async () => null, module: null });
    const backup = source({ characters: [{ ...luna, chats: [{ ...luna.chats[0]!, persona: null }] }], personas: [persona('진'), persona('솔')] });
    await moveFromRisu(store, files, backup, backup.catalog, null, () => {});
    const jin = store.list('persona').find(({ value }) => value.name === '진')!.id;
    expect([accountSettings(store)!.persona, store.list('chat')[0]!.value.persona]).toEqual([jin, jin]);
  });

  it.each(['entry', 'character'] as const)('stages every chat of a character in one batch, publishes the roots with their character, summarizes them in one request from what it wrote, and retries a cut at the %s write leaving no chat without its character', async (cut) => {
    const { store, files } = await server.account();
    const chats = Array.from({ length: 2 }, (_, index) => ({
      ...luna.chats[0]!, greeting: 0,
      messages: Array.from({ length: 130 }, (_, at) => ({ role: 'user' as const, text: `chat ${index} / ${at}`, at: index * 1000 + at })),
    }));
    const backup = source({ characters: [{ ...luna, chats }] });
    const orphans = () => store.list('chat').filter(({ value }) => !store.get('character', value.character!));
    const batch = store.batch.bind(store);
    let armed = true;
    vi.spyOn(store, 'batch').mockImplementation(async (writes, progress, options) => {
      const character = writes.find((write) => write.type === 'create' && write.kind === 'character');
      const roots = writes.flatMap((write) => (write.type === 'create' && write.kind === 'chat' ? [write.id] : []));
      const staged = new Set(writes.flatMap((write) => (write.type === 'create' && write.kind === 'entry' ? [write.parent] : [])));
      if (character) {
        expect(roots).toHaveLength(2);
        expect(store.list('chat')).toHaveLength(0);
        // Held through the character's write: their summaries come from what this device wrote, pulling nothing.
        expect(roots.every((id) => store.scopeState(id) === 'loaded')).toBe(true);
      } else {
        expect(roots).toHaveLength(0);
        expect(staged.size).toBe(2);
      }
      if (armed && cut === 'character' && character) { armed = false; return { ok: false, error: 'stopped' }; }
      const result = await batch(writes, progress, options);
      if (armed && cut === 'entry' && staged.size) { armed = false; return { ok: false, error: 'stopped' }; }
      return result;
    });
    const fetched = vi.spyOn(globalThis, 'fetch');
    expect(await moveFromRisu(store, files, backup, backup.catalog, null, () => {})).toEqual({ ok: false, error: 'stopped' });
    expect(store.list('character')).toHaveLength(0);
    expect(orphans()).toEqual([]);
    expect(broughtFromRisu(store).size).toBe(0);
    const steps: MoveStep[] = [];
    const retried = await moveFromRisu(store, files, backup, backup.catalog, null, (step) => steps.push(step));
    expect(retried.ok).toBe(true);
    const last = new Map(steps.map((step) => [step.kind, step]));
    expect(last.get('chats')).toEqual({ kind: 'chats', done: 2, total: 2 });
    expect(last.get('characters')).toEqual({ kind: 'characters', done: 1, total: 1 });
    expect([...last.values()].filter(({ done, total }) => done !== total)).toEqual([]);
    expect(store.list('character')).toHaveLength(1);
    expect(orphans()).toEqual([]);
    const visible = store.list('chat');
    expect(visible).toHaveLength(2);
    for (const chat of visible) {
      const summary = store.get('summary', summaryId(chat.id))!.value;
      expect(summary.count).toBe(130);
      expect(summaryStale(store, chat.id, summary)).toBe(false);
      expect(store.scopeState(chat.id)).toBe('unloaded');
    }
    const sent = fetched.mock.calls.map(([url, init]) => ({ url: String(url), method: init?.method ?? 'GET', writes: typeof init?.body === 'string' && init.body.startsWith('{"timeline') ? (JSON.parse(init.body) as { writes: { kind: string }[] }).writes : [] }));
    expect(sent.filter(({ method, url }) => method === 'GET' && url.includes('parent='))).toEqual([]);
    expect(sent.flatMap(({ writes }) => (writes.length && writes.every(({ kind }) => kind === 'summary') ? [writes.length] : []))).toEqual([2]);
    expect(await moveFromRisu(store, files, backup, backup.catalog, null, () => {})).toMatchObject({ ok: true, data: { characters: [] } });
  }, 30_000);

  it("sets the 로어북 최대 분량 the user set in Risu, only on an account that has set none", async () => {
    const { store, files } = await server.account();
    const backup = source({ characters: [], loreBudget: 150_000 });
    expect(await moveFromRisu(store, files, backup, backup.catalog, null, () => {})).toMatchObject({ ok: true, data: { loreBudget: 150_000 } });
    expect(sharedLoreScan(store).tokenBudget).toBe(150_000);
    await setSharedLoreScan(store, 'tokenBudget', 3_000);
    const again = source({ characters: [], loreBudget: 9_000 });
    expect(await moveFromRisu(store, files, again, again.catalog, null, () => {})).toMatchObject({ ok: true, data: { loreBudget: null } });
    expect(sharedLoreScan(store).tokenBudget).toBe(3_000);
  });

  it("gives every character it brings Risu's toggle values, and 캐릭터 없이 only the keys it holds none for", async () => {
    const { store, files } = await server.account();
    await setToggle(store, null, 'tagger', '0');
    const backup = source({ characters: [luna], toggles: { tagger: '1', style: '2' } });
    const moved = await moveFromRisu(store, files, backup, backup.catalog, null, () => {});
    expect(moved).toMatchObject({ ok: true, data: { toggles: 2 } });
    expect(store.get('character', moved.ok ? moved.data.characters[0]!.id : '')!.value.toggles).toEqual({ tagger: '1', style: '2' });
    expect(accountSettings(store)!.toggles).toEqual({ tagger: '0', style: '2' });
    expect(await moveFromRisu(store, files, backup, backup.catalog, null, () => {})).toMatchObject({ ok: true, data: { toggles: 0 } });
  });

  it('writes what was talked in last last, so the lists open on it', async () => {
    const { store, files } = await server.account();
    const chatAt = (title: string, at: number) => ({ ...luna.chats[0]!, title, messages: [{ role: 'user' as const, text: title, at }] });
    const recent = { ...luna, id: 'risu-recent', chats: [chatAt('어제', 20), chatAt('작년', 5)] };
    const old = { ...luna, id: 'risu-old', chats: [chatAt('옛날', 1)] };
    const backup = source({ characters: [recent, old] });
    await moveFromRisu(store, files, backup, backup.catalog, null, () => {});
    expect(store.list('chat').sort((a, b) => a.rev - b.rev).map(({ value }) => value.title)).toEqual(['옛날', '작년', '어제']);
  });

  it('brings a module before the character it is on for, on where Risu had it on, and a second run brings neither again nor turns 항상 back on', async () => {
    const { store, files } = await server.account();
    const characters = [{ ...luna, modules: ['risu-bell', 'risu-gone'] }];
    const backup = source({ characters, modules: [bell], alwaysModules: ['risu-bell', 'risu-gone'] });
    const moved = await moveFromRisu(store, files, backup, backup.catalog, null, () => {});
    expect(moved).toMatchObject({ ok: true, data: { modules: [{ name: bell.name, unsupported: [...bell.unsupported, { kind: 'unsupported-file', count: 1 }] }], characters: [{ risu: 'risu-luna' }] } });
    const [module] = store.list('module');
    expect(module!.value).toMatchObject({ name: 'Bell', risu: 'risu-bell' });
    expect(store.children('asset', module!.id).map(({ value }) => value.name)).toEqual(['ring']);
    expect(store.list('settings')[0]!.value.modules).toEqual([module!.id]);
    const [character] = store.list('character');
    expect(character!.value.modules).toEqual([module!.id]);

    await setModuleAlways(store, module!.id, false);
    const next = source({ characters: [...characters, { ...luna, id: 'risu-sol', modules: ['risu-bell'] }], modules: [bell], alwaysModules: backup.catalog.alwaysModules });
    expect(await moveFromRisu(store, files, next, next.catalog, null, () => {})).toMatchObject({ ok: true, data: { modules: [], characters: [{ risu: 'risu-sol' }] } });
    expect(store.list('module')).toHaveLength(1);
    expect(store.list('settings')[0]!.value.modules).toEqual([]);
    expect(store.list('character').find(({ value }) => value.risu === 'risu-sol')!.value.modules).toEqual([module!.id]);
  });

  it('brings each persona\'s own module as a module of its own, on for that persona alone, though Risu gives them one id', async () => {
    const { store, files } = await server.account();
    const embedded = (name: string): ImportedModule => ({ ...bell, name, risu: '$embedded', unsupported: [{ kind: 'mcp', count: 1 }] });
    const persona = (name: string): RisuPersona => ({ id: name, name, alias: '', description: '', picture: async () => null, module: embedded(name) });
    const backup = source({ characters: [], personas: [persona('진'), persona('솔')] });
    const moved = await moveFromRisu(store, files, backup, backup.catalog, null, () => {});
    expect(moved).toMatchObject({ ok: true, data: { personas: 2, modules: [{ name: '진', unsupported: [{ kind: 'unsupported-file', count: 1 }, { kind: 'mcp', count: 1 }] }, { name: '솔' }] } });
    const modules = new Map(store.list('module').map(({ id, value }) => [value.name, { id, value }]));
    expect(modules.size).toBe(2);
    expect(modules.get('진')!.value).not.toHaveProperty('risu');
    for (const name of ['진', '솔']) expect(store.list('persona').find(({ value }) => value.name === name)!.value.modules).toEqual([modules.get(name)!.id]);
  });

  it('turns a preset\'s modules on for its prompt, named by Risu id or namespace, each once, and drops a name the backup lacks', async () => {
    const { store, files } = await server.account();
    const chime: ImportedModule = { ...bell, name: 'Chime', namespace: 'chime', risu: null, assets: [] };
    const presets: RisuPreset[] = [{ name: '짝', result: convertPreset({ name: '짝', promptTemplate: [], moduleIntergration: 'chime, risu-bell ,risu-gone,chime' }) }];
    const backup = source({ characters: [], presets, modules: [bell, chime] });
    expect(await moveFromRisu(store, files, backup, backup.catalog, null, () => {})).toMatchObject({ ok: true, data: { prompts: 1 } });
    const ids = new Map(store.list('module').map(({ id, value }) => [value.name, id]));
    expect(store.list('prompt').find(({ value }) => value.name === '짝')!.value).toMatchObject({ modules: [ids.get('Chime'), ids.get('Bell')] });
  });
});

describe('importRisuChats', () => {
  it('writes the chats of a Risu chat file in one batch, their messages staged, with the current persona', async () => {
    const { store } = await server.account();
    const current = await addPersona(store, { name: '진', description: '', picture: null });
    await setCurrentPersona(store, current.ok ? current.data.id : '');
    const batch = vi.spyOn(store, 'batch');
    const imported = await importRisuChats(store, null, [luna.chats[0]!, { ...luna.chats[0]!, title: '둘째' }]);
    if (!imported.ok) throw new Error(imported.error);
    expect(batch).toHaveBeenCalledOnce();
    expect(imported.data.map((id) => store.get('chat', id)!.value.persona)).toEqual([current.ok && current.data.id, current.ok && current.data.id]);
    await server.hold(store, imported.data[0]!);
    expect(fold(store.children('entry', imported.data[0]!)).map((message) => [shown(message).text, shown(message).staged])).toEqual([['안녕', true], ['반가워 [HP 7]', true]]);
  });

  it('writes a chat\'s own lorebook under it, its folders on the chat', async () => {
    const { store } = await server.account();
    const entry = { name: '등대', keys: ['등대'], secondaryKeys: [], content: '불이 꺼졌다', enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 100, priority: null, position: null };
    const imported = await importRisuChats(store, null, [{ ...luna.chats[0]!, lore: [{ ...entry, folder: 0 }], loreFolders: ['장소'] }]);
    if (!imported.ok) throw new Error(imported.error);
    const [folder] = store.get('chat', imported.data[0]!)!.value.loreFolders!;
    expect(folder!.name).toBe('장소');
    expect(store.children('lore', imported.data[0]!).map(({ value }) => value)).toEqual([{ ...entry, folder: folder!.id }]);
  });

  it("marks the messages Risu bookmarked, with the names it gave", async () => {
    const { store } = await server.account();
    const [hello, reply] = luna.chats[0]!.messages;
    const imported = await importRisuChats(store, null, [{ ...luna.chats[0]!, messages: [{ ...hello!, bookmark: { name: '첫인사' } }, { ...reply!, bookmark: {} }] }]);
    if (!imported.ok) throw new Error(imported.error);
    await server.hold(store, imported.data[0]!);
    const messages = fold(store.children('entry', imported.data[0]!));
    expect(store.get('chat', imported.data[0]!)!.value.bookmarks).toEqual([{ message: messages[0]!.id, name: '첫인사' }, { message: messages[1]!.id }]);
  });
});

describe('fillPictures', () => {
  it('adds the pictures of names the character does not have, and counts the ones that are not pictures', async () => {
    const { store, files } = await server.account();
    const added = await importCharacter(store, files, { card: { name: '루나' } as Card, lore: [], loreFolders: [], assets: [{ name: 'smile', read: async () => png() }] }, null, () => {});
    const id = added.ok ? added.data.id : '';
    const [smile] = store.children('asset', id);
    const assets = [
      { name: 'smile', read: async () => png() },
      { name: 'wave', read: async () => png() },
      { name: 'notes', read: async () => randomBytes(8) },
    ];
    expect(await fillPictures(store, files, { kind: 'asset', parent: id }, assets)).toMatchObject({ ok: true, data: { kept: [{ name: 'wave' }], unsupported: [{ kind: 'unsupported-file', count: 1 }] } });
    expect(store.children('asset', id).map(({ value }) => value.name).sort()).toEqual(['smile', 'wave']);
    expect(store.children('asset', id).find(({ value }) => value.name === 'smile')).toEqual(smile);
  });
});

const inlayFile = (held: Record<string, Uint8Array<ArrayBuffer>>): Inlays => ({ count: Object.keys(held).length, bytes: 0, assets: (ids) => ids.map((id) => ({ name: id, read: async () => held[id] ?? null })) });
const signature = () => new TextEncoder().encode(JSON.stringify({ type: 'signature', data: 'sig' }));

describe('inlays', () => {
  it('the move fills its chats from the export and counts the pictures not brought, one past the picture cap too', async () => {
    const { store } = await server.account();
    const [kept, over] = [png(), png()];
    const full = (await sealFile(over)).ref.id;
    const files = new Files(serverBackend(async <T,>(...args: Parameters<typeof api>) => (args[0] === 'PUT' && args[1] === `files/${full}` ? { ok: false as const, error: 'files-full' } : api<T>(...args))), store);
    const backup = source({ characters: [{ ...luna, chats: [{ ...luna.chats[0]!, inlays: ['a', 'gone', 'over', 's'] }] }] });
    const moved = await moveFromRisu(store, files, backup, backup.catalog, inlayFile({ a: kept, over, s: signature() }), () => {});
    expect(moved).toMatchObject({ ok: true, data: { characters: [{ missed: [{ kind: 'inlay', count: 2 }] }] } });
    const [chat] = store.list('chat');
    await server.hold(store, chat!.id);
    expect(store.children('inlay', chat!.id).map(({ value }) => [value.name, value.type]).sort()).toEqual([['a', 'image/png'], ['s', 'signature']]);
  });

  it('fills the chats already here from the messages that name them, and a second pass adds nothing', async () => {
    const { store, files } = await server.account();
    const messages = [{ role: 'user' as const, text: '봐 {{inlayed::a}}', at: 1 }, { role: 'assistant' as const, text: '{{inlayeddata::a}} {{inlay::gone}}', at: 2 }];
    const made = await importRisuChats(store, null, [{ ...luna.chats[0]!, inlays: [], messages }]);
    const chat = made.ok ? made.data[0]! : '';
    const pass = () => fillInlays(store, files, inlayFile({ a: png() }), () => {}, new AbortController().signal);
    expect(await pass()).toEqual({ ok: true, data: { chats: 1, total: 1, pictures: 1, missed: 1, unread: 0 } });
    expect(await pass()).toEqual({ ok: true, data: { chats: 1, total: 1, pictures: 0, missed: 1, unread: 0 } });
    await server.hold(store, chat);
    expect(store.children('inlay', chat).map(({ value }) => value.name)).toEqual(['a']);
  });
});
