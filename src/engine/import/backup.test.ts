import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { backupInlays, readBackup } from './backup';
import { moduleSource } from './hazelle';
import type { RisuBackup } from './types';

const u32 = (value: number, little: boolean) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, little);
  return [...out];
};

// msgpackr's output for the shapes a database holds, undefined as its d4 00 00 extension.
function pack(value: unknown): number[] {
  if (value === undefined) return [0xd4, 0, 0];
  if (value === null) return [0xc0];
  if (typeof value === 'boolean') return [value ? 0xc3 : 0xc2];
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value < 0x80) return [value];
    const out = new Uint8Array(9);
    out[0] = 0xcb;
    new DataView(out.buffer).setFloat64(1, value);
    return [...out];
  }
  if (typeof value === 'string') {
    const bytes = strToU8(value);
    return [0xdb, ...u32(bytes.length, false), ...bytes];
  }
  if (Array.isArray(value)) return [0xdd, ...u32(value.length, false), ...value.flatMap(pack)];
  const entries = Object.entries(value as object);
  return [0xdf, ...u32(entries.length, false), ...entries.flatMap(([key, item]) => [...pack(key), ...pack(item)])];
}

const database = (db: unknown) => new Uint8Array([0, ...strToU8('RISUSAVE'), 0, 8, ...gzipSync(new Uint8Array(pack(db)))]);

// The block form Risu writes since 2026-10-14: root holds every key but characters, presets and modules; the gzip flag
// is per block.
function blocks(db: Record<string, unknown>) {
  const block = (type: number, name: string, value: unknown, zipped: boolean) => {
    const text = strToU8(JSON.stringify(value));
    const data = zipped ? gzipSync(text) : text;
    return [type, zipped ? 1 : 0, strToU8(name).length, ...strToU8(name), ...u32(data.length, true), ...data];
  };
  const { characters, botPresets, modules, ...root } = db;
  const list = [
    ...block(1, 'root', { ...root, __directory: ['preset', 'modules', 'config'] }, true),
    ...block(4, 'preset', botPresets, false),
    ...block(5, 'modules', modules, true),
    ...block(10, 'loadouts', [], false),
    ...(characters as ({ chaId?: string } | null)[]).flatMap((character, i) => (character ? block(2, character.chaId ?? `c${i}`, character, i % 2 === 0) : [])),
    ...block(12, 'kv:stats', { version: 1, entries: [] }, false),
    ...block(0, 'config', { version: 1 }, false),
  ];
  return new Uint8Array([...strToU8('RISUSAVE'), 0, ...list]);
}

function bin(entries: [string, Uint8Array][]) {
  const file = new Blob(entries.flatMap(([name, data]) => [new Uint8Array([...u32(strToU8(name).length, true), ...strToU8(name), ...u32(data.length, true)]), new Uint8Array(data)]));
  return { size: file.size, read: async (offset: number, length: number) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const COLD = 'COLDSTORAGE';
const CHAT_KEY = '11111111-1111-4111-8111-111111111111';
const CHARACTER_KEY = '22222222-2222-4222-8222-222222222222';
const json = (value: unknown) => strToU8(JSON.stringify(value));

const mira = {
  chaId: 'mira',
  name: 'Mira',
  image: 'assets/mira.png',
  desc: 'd',
  firstMessage: 'hi',
  alternateGreetings: ['hello', 'yo'],
  replaceGlobalNote: 'stay in character',
  postHistoryInstructions: 'old note',
  customscript: [{ comment: 'r', in: 'a', out: 'b', type: 'editoutput' }],
  triggerscript: [{ comment: 'lua', type: 'start', conditions: [], effect: [{ type: 'triggerlua', code: 'print(1)' }] }],
  lowLevelAccess: true,
  globalLore: [{ key: 'castle', secondkey: '', insertorder: 100, comment: 'Castle', content: '<user> sees\n@@end', mode: 'normal', alwaysActive: false, selective: false, activationPercent: 40 }],
  additionalAssets: [
    ['map', 'assets/map.png', 'png'],
    ['gone', 'assets/gone.png', 'png'],
  ],
  modules: ['m1'],
  chatFolders: [{ id: 'f', folded: false }],
  chatPage: 0,
  chats: [
    {
      name: 'Live',
      note: '',
      fmIndex: 1,
      bindedPersona: 'p1',
      lastDate: 500,
      scriptstate: { $mood: 'calm', $count: 3, plain: 'x' },
      bookmarks: ['c1', 'c2', 'gone'],
      bookmarkNames: { c1: ' 시작 ' },
      modules: ['m1', 'm2'],
      localLore: [],
      message: [
        { role: 'user', data: 'hey', time: 1000, chatId: 'c1' },
        { role: 'char', data: '<Thoughts>\nhmm\n</Thoughts>\n\nlook {{inlay::abc}}', disabled: true, chatId: 'c2' },
      ],
    },
    { name: 'Cold', note: 'n', localLore: [], scriptstate: {}, message: [{ role: 'char', data: COLD + CHAT_KEY, time: 900 }] },
    { name: 'Empty', note: '', localLore: [], modules: ['m3'], message: [] },
    { name: 'Lost', note: '', localLore: [], message: [{ role: 'char', data: `${COLD}33333333-3333-4333-8333-333333333333`, time: 1 }] },
  ],
};

const db = {
  account: undefined,
  characters: [
    null,
    mira,
    { type: 'character', chaId: 'sleeper', name: 'Sleeper', coldstorage: CHARACTER_KEY, chats: [{ message: [{ role: 'char', data: '' }] }] },
    { type: 'group', chaId: 'g', chats: [{ message: [{ role: 'user', data: 'x' }] }, { message: [] }] },
    { chaId: 'trashed', name: 'T', trashTime: 1, chats: [] },
    { chaId: '§temp', name: 'Temp', chats: [] },
    { type: 'character', chaId: 'gone', coldstorage: '44444444-4444-4444-8444-444444444444', chats: [] },
  ],
  characterOrder: [{ name: 'Fav', data: ['sleeper'] }, 'mira'],
  modules: [
    {
      id: 'm1',
      name: 'Bell',
      description: 'rings',
      namespace: 'bell',
      lorebook: [{ key: 'bell', secondkey: '', insertorder: 10, comment: 'Bell', content: 'It rings.', mode: 'normal', alwaysActive: true, selective: false }],
      regex: [{ comment: 'ring', in: 'ding', out: 'dong', type: 'editdisplay' }],
      assets: [
        ['bell', 'assets/bell.png', 'png'],
        ['lost', 'assets/lost.png', 'png'],
      ],
    },
  ],
  enabledModules: ['m1'],
  loreBookToken: 150000,
  globalChatVariables: { toggle_tagger: '1', toggle_style: '2', toggle_count: 3, hp: '7' },
  personas: [
    { id: 'p1', name: 'old', personaPrompt: 'stale', icon: '', embeddedModule: { id: '$embedded', name: 'Ann', description: '', lorebook: [{ key: 'cape', secondkey: '', insertorder: 10, comment: 'Cape', content: 'A red cape.', mode: 'normal', alwaysActive: true, selective: false }], mcp: { url: 'https://mcp.example' }, cjs: 'run()' } },
    { id: 'p2', name: 'Bob', personaPrompt: 'b', icon: 'assets/bob.png', note: ' the rich one ' },
  ],
  selectedPersona: 0,
  username: 'Ann',
  personaPrompt: 'live',
  userIcon: 'assets/ann.png',
  botPresets: [
    { name: 'Main', openAIKey: 'sk-slot', mainPrompt: '', promptTemplate: [{ type: 'plain', type2: 'main', role: 'system', text: 'stale' }] },
    { name: 'Legacy', mainPrompt: 'x' },
  ],
  botPresetsId: 0,
  openAIKey: 'sk-top',
  mainPrompt: '',
  promptTemplate: [{ type: 'plain', type2: 'main', role: 'system', text: 'live' }],
};

const backupEntries = (data: Uint8Array): [string, Uint8Array][] => [
  ['mira.png', PNG],
  ['map.png', PNG],
  ['ann.png', PNG],
  ['bell.png', PNG],
  [`coldstorage_${CHAT_KEY}.json`, json({ message: [{ role: 'user', data: 'old', time: 10 }], scriptstate: { $x: { a: 1 } }, localLore: [{ key: 'places', comment: 'Places', mode: 'folder' }, { key: 'k', comment: 'Key', content: '<char>\n@@end', activationPercent: 40, folder: 'places' }], hypaV3Data: { summaries: [{}] } })],
  [`coldstorage_${CHARACTER_KEY}.json`, json({ character: { chaId: 'sleeper', name: 'Sleeper', firstMessage: 'zzz', chats: [{ name: 'Nap', message: [{ role: 'user', data: 'wake', time: 5 }] }] } })],
  ['database.risudat', data],
];
const backupFile = (data = database(db)) => bin(backupEntries(data));

async function read(): Promise<RisuBackup> {
  const result = await readBackup([backupFile()]);
  if (!result.ok) throw new Error(result.failure.kind);
  return result.backup;
}

describe('readBackup', () => {
  it('coalesces nearby headers across window boundaries and skips large pictures until requested', async () => {
    const window = 4 * 1024 * 1024;
    const picture = new Uint8Array(3 * window);
    picture.set(PNG);
    const data = database({ ...db, botPresets: [] });
    const source = bin([
      ['padding', new Uint8Array(window - 2 - 8 - 'padding'.length)],
      ['mira.png', picture],
      ['map.png', PNG],
      ['ann.png', PNG],
      ['database.risudat', data],
    ]);
    const read = vi.fn(source.read);
    const result = await readBackup([{ size: source.size, read }]);
    const reference = await readBackup([bin([
      ['padding', new Uint8Array(1)], ['mira.png', picture], ['map.png', PNG], ['ann.png', PNG], ['database.risudat', data],
    ])]);
    // The padding entry differs in size between the two, and every entry but the database's counts as a picture.
    const unsized = (read: unknown) => JSON.stringify(read, (key, value: unknown) => (key === 'pictureBytes' ? undefined : value));
    expect(unsized(result)).toBe(unsized(reference));
    expect(result.ok && result.backup.catalog.pictureBytes).toBe(window - 2 - 8 - 'padding'.length + picture.length + 2 * PNG.length);
    expect(read.mock.calls).toEqual([
      [0, window],
      [window - 2, window],
      [4 * window + 14, source.size - (4 * window + 14)],
      [source.size - data.length, data.length],
    ]);
    if (!result.ok) throw new Error(result.failure.kind);
    const character = await result.backup.character(result.backup.catalog.characters[0]!.key);
    if (!reference.ok) throw new Error(reference.failure.kind);
    expect(JSON.stringify(character)).toBe(JSON.stringify(await reference.backup.character(reference.backup.catalog.characters[0]!.key)));
    const avatar = await character.avatar();
    expect(avatar?.type).toBe('image/png');
    expect(avatar?.bytes.length).toBe(picture.length);
    expect(avatar?.bytes.every((byte, i) => byte === picture[i])).toBe(true);
    expect(read.mock.calls.at(-1)).toEqual([window + 14, picture.length]);
  });

  it('bounds cold metadata reads and loads only the selected character as message histories', async () => {
    const characters = Array.from({ length: 12 }, (_, i) => ({ chaId: `c${i}`, coldstorage: `c${i}` }));
    const entries: [string, Uint8Array][] = characters.flatMap(({ chaId }) => {
      const chats = Array.from({ length: 3 }, (_, i) => ({ name: `${chaId}-${i}`, message: [{ role: 'char', data: `${COLD}${chaId}-${i}` }] }));
      return [
        [`coldstorage_${chaId}.json`, json({ character: { chaId, name: chaId, chats } })],
        ...chats.map(({ name }): [string, Uint8Array] => [`coldstorage_${name}.json`, json({ message: [{ role: 'user', data: name, time: 1 }] })]),
      ];
    });
    const source = bin([['database.risudat', database({ characters })], ...entries]);
    let active = 0;
    let peak = 0;
    const result = await readBackup([{
      size: source.size,
      async read(offset, length) {
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, offset % 3));
        try {
          return await source.read(offset, length);
        } finally {
          active--;
        }
      },
    }]);
    expect(peak).toBe(8);
    expect(active).toBe(0);
    if (!result.ok) throw new Error(result.failure.kind);
    const { catalog } = result.backup;
    expect(catalog.characters.map(({ id, chatCount }) => [id, chatCount])).toEqual(characters.map(({ chaId }) => [chaId, 3]));
    expect(catalog.characters.every((character) => !('chats' in character))).toBe(true);
    const selected = await result.backup.character(catalog.characters[5]!.key);
    expect(selected.chats.map((chat) => chat.messages[0]!.text)).toEqual(['c5-0', 'c5-1', 'c5-2']);
    expect(peak).toBe(8);
  });

  it('takes the text from the partial backup and the pictures from the account backup dropped with it', async () => {
    const result = await readBackup([
      bin([['encryption.risudat', json({ type: 'account' })], ['mira.png', PNG], ['map.png', PNG], ['database.risudat', strToU8('locked')]]),
      bin([['database.risudat', database(db)]]),
    ]);
    if (!result.ok) throw new Error(result.failure.kind);
    expect(result.backup.catalog.pictures).toBe(2);
    const card = await result.backup.character(result.backup.catalog.characters[0]!.key);
    expect(await card.avatar()).toEqual({ bytes: PNG, type: 'image/png' });
    expect(card.assets.map(({ name }) => name)).toEqual(['map']);
  });

  it("carries the lorebook budget the user set, and not Risu's own default", async () => {
    expect((await read()).catalog.loreBudget).toBe(150000);
    const left = await readBackup([bin([['database.risudat', database({ ...db, loreBookToken: 800 })]])]);
    expect(left.ok && left.backup.catalog.loreBudget).toBeNull();
  });

  it("counts a lore scan depth changed from Risu's 5, which this app does not take", async () => {
    const depth = async (loreBookDepth: number) => {
      const result = await readBackup([bin([['database.risudat', database({ ...db, loreBookDepth })]])]);
      return result.ok && result.backup.catalog.unsupported.some(({ kind }) => kind === 'lore-depth');
    };
    expect([await depth(10), await depth(5)]).toEqual([true, false]);
  });

  it("carries a character's 번역가의 노트 and counts its 출력 이스케이프", async () => {
    const noted = { ...mira, translatorNote: 'Master -> 주인님\n', escapeOutput: true };
    const result = await readBackup([backupFile(database({ ...db, characters: db.characters.map((char) => (char === mira ? noted : char)) }))]);
    if (!result.ok) throw new Error(result.failure.kind);
    const [card, plain] = await Promise.all([result.backup.character(1), (await read()).character(1)]);
    expect(card.own).toEqual({ character: { translatorNote: 'Master -> 주인님\n' }, likeness: null });
    expect(card.missed).toContainEqual({ kind: 'escape-output', count: 1 });
    expect([plain.own, plain.missed.some(({ kind }) => kind === 'escape-output')]).toEqual([null, false]);
  });

  it("counts a character's 추가 캐릭터 스크린 only when Risu's is on", async () => {
    const screen = async (viewScreen: string) => {
      const result = await readBackup([backupFile(database({ ...db, characters: db.characters.map((char) => (char === mira ? { ...mira, viewScreen, inlayViewScreen: true } : char)) }))]);
      if (!result.ok) throw new Error(result.failure.kind);
      return (await result.backup.character(1)).report.unsupported.some(({ kind }) => kind === 'view-screen');
    };
    expect([await screen('emotion'), await screen('none')]).toEqual([true, false]);
  });

  it('carries the toggle values by key, and no other global variable', async () => {
    expect((await read()).catalog.toggles).toEqual({ tagger: '1', style: '2' });
  });

  it('refuses an encrypted, database-less or undecodable backup', async () => {
    expect(await readBackup([bin([['encryption.risudat', json({ type: 'account' })], ['database.risudat', database(db)]])])).toEqual({ ok: false, failure: { kind: 'encrypted' } });
    expect(await readBackup([bin([['mira.png', PNG]])])).toEqual({ ok: false, failure: { kind: 'no-database' } });
    expect(await readBackup([bin([['database.risudat', PNG]])])).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
  });

  it('holds the blocks of a database to one unpacking limit together', async () => {
    const padded = gzipSync(strToU8(`${' '.repeat(33 * 1024 * 1024)}{}`));
    const block = [1, 1, 4, ...strToU8('root'), ...u32(padded.length, true), ...padded];
    const database = (count: number) => new Uint8Array([...strToU8('RISUSAVE'), 0, ...Array.from({ length: count }, () => block).flat()]);
    expect(await readBackup([backupFile(database(1))])).toMatchObject({ ok: true });
    expect(await readBackup([backupFile(database(2))])).toEqual({ ok: false, failure: { kind: 'expands-too-far' } });
  });

  it('reads the block form of the database as it reads the legacy form', async () => {
    // Risu's block writer reads chaId off every character, so a block file never holds the null the legacy fixture does.
    const whole = { ...db, characters: db.characters.filter((character) => character !== null) };
    const legacy = await readBackup([backupFile(database(whole))]);
    const blocked = await readBackup([backupFile(blocks(whole))]);
    if (!legacy.ok || !blocked.ok) throw new Error('unreadable');
    expect(blocked.backup.catalog).toEqual(legacy.backup.catalog);
    // The character carries lazy readers, which never compare equal; the data they wrap does.
    const plain = async (backup: RisuBackup) => JSON.parse(JSON.stringify(await backup.character(1)));
    expect(await plain(blocked.backup)).toEqual(await plain(legacy.backup));
  });

  it("reads a PocketRisu backup: its unzipped database, its cold entries in a folder, and the inlays it holds, which are not counted as the backup's pictures", async () => {
    const plain = new Uint8Array([0, ...strToU8('RISUSAVE'), 0, 7, ...pack(db)]);
    const file = bin([
      ...backupEntries(plain).map(([name, data]): [string, Uint8Array] => [name.replace('coldstorage_', 'coldstorage/'), data]),
      ['inlay/pic.png', PNG],
      ['inlay_sidecar/pic', json({ type: 'image' })],
      ['inlay_meta/pic', json({})],
    ]);
    const pocket = await readBackup([file]);
    if (!pocket.ok) throw new Error(pocket.failure.kind);
    expect(pocket.backup.catalog).toEqual((await read()).catalog);
    const inlays = (await backupInlays(file))!;
    expect([inlays.count, inlays.bytes]).toEqual([1, PNG.length]);
    expect(await Promise.all(inlays.assets(['pic', 'gone']).map(({ read }) => read()))).toEqual([PNG, null]);
    expect(await backupInlays(backupFile())).toBeNull();
  });

  it('brings characters out of cold storage, in Risu order, as cards with lazy pictures', async () => {
    const backup = await read();
    const characters = await Promise.all(backup.catalog.characters.map(({ key }) => backup.character(key)));
    expect(backup.catalog.characters).toEqual([
      { key: 2, id: 'sleeper', name: 'Sleeper', chatCount: 1, assetCount: 0, inlayCount: 0, lastTalk: 5 },
      { key: 1, id: 'mira', name: 'Mira', chatCount: 2, assetCount: 1, inlayCount: 1, lastTalk: 1000 },
    ]);
    expect(characters.map(({ id, folder }) => [id, folder])).toEqual([
      ['sleeper', 'Fav'],
      ['mira', null],
    ]);
    expect(characters[0]!.chats).toEqual([{ title: 'Nap', note: null, persona: null, greeting: 0, variables: [], inlays: [], lore: [], loreFolders: [], messages: [{ role: 'user', text: 'wake', at: 5 }] }]);
    expect(backup.catalog.unsupported).toEqual([
      { kind: 'group-chat', count: 1 },
      { kind: 'cold-missing', count: 1 },
    ]);
    const card = characters[1]!;
    expect(card.card).toMatchObject({
      greetings: ['hi', 'hello', 'yo'],
      postHistoryInstructions: 'stay in character',
      regex: [{ id: 'regex-0', name: 'r', find: 'a', replace: 'b', stage: 'output', flags: null }],
      triggers: [{ kind: 'lua', id: 'trigger-0', name: 'lua', code: 'print(1)' }],
    });
    expect(card.lore[0]!.content).toBe('@@probability 40\n{{user}} sees\n@@depth 0');
    expect(await card.avatar()).toEqual({ bytes: PNG, type: 'image/png' });
    expect(card.assets.map(({ name }) => name)).toEqual(['map']);
    expect(await card.assets[0]!.read()).toEqual(PNG);
  });

  it('maps chats, collects the inlay ids each names, and counts what they held that does not come', async () => {
    const backup = await read();
    const card = await backup.character(backup.catalog.characters[1]!.key);
    expect(card.chats).toEqual([
      {
        title: 'Live',
        note: 'old note',
        persona: 'p1',
        greeting: 2,
        variables: [
          ['mood', 'calm'],
          ['count', '3'],
        ],
        inlays: ['abc'],
        messages: [
          { role: 'user', text: 'hey', at: 1000, bookmark: { name: '시작' } },
          { role: 'assistant', text: 'look {{inlay::abc}}', at: 1000, reasoning: 'hmm', bookmark: {} },
        ],
        lore: [],
        loreFolders: [],
      },
      {
        title: 'Cold',
        note: 'n',
        persona: null,
        greeting: 0,
        variables: [['x', '{"a":1}']],
        inlays: [],
        messages: [{ role: 'user', text: 'old', at: 10 }],
        // Unmigrated, as Risu leaves a chat's lorebook.
        lore: [{ name: 'Key', keys: ['k'], secondaryKeys: [], content: '<char>\n@@end', enabled: true, constant: false, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 100, priority: null, position: null, folder: 0 }],
        loreFolders: ['Places'],
      },
    ]);
    expect(card.missed).toEqual(
      (['memory', 'chat-folder', 'hidden-message', 'cold-missing', 'missing-picture'] as const).map((kind) => ({ kind, count: 1 })),
    );
  });

  it('converts native character and module lore once according to bookVersion without replacing the character scripts', async () => {
    const lore = [
      { key: 'folder', comment: 'Places', mode: 'folder' },
      { key: 'castle', secondkey: 'queen', comment: 'Current', folder: 'folder', bookVersion: 2, activationPercent: 40, content: '@@probability 40\n<char> <user>\n@@end' },
      { key: 'garden', comment: 'Old', bookVersion: 1, activationPercent: 40, content: '<char> <user>\n@@end' },
    ];
    const result = await readBackup([bin([['database.risudat', database({
      characters: [{ ...mira, chats: [], globalLore: lore }],
      modules: [{ name: 'Lore', lorebook: lore }],
    })]])]);
    if (!result.ok) throw new Error(result.failure.kind);
    const character = await result.backup.character(result.backup.catalog.characters[0]!.key);
    const module = await result.backup.module(result.backup.catalog.modules[0]!.key);
    expect(character.lore).toEqual(module.lore);
    expect(character.loreFolders).toEqual(['Places']);
    expect(character.lore.map(({ content }) => content)).toEqual([
      '@@probability 40\n<char> <user>\n@@end',
      '@@probability 40\n{{char}} {{user}}\n@@depth 0',
    ]);
    expect(character.card.regex[0]!.name).toBe('r');
    expect(character.card.triggers).toEqual([{ kind: 'lua', id: 'trigger-0', name: 'lua', code: 'print(1)' }]);
  });

  it('reads back the hazelle key of a .risum this app wrote that Risu then kept in its backup', async () => {
    const off = { id: 'trigger-0', kind: 'lua' as const, name: 'main', code: 'return 1', off: true as const };
    const source = moduleSource({ risu: 'm', name: '전화', description: '', namespace: null, likeness: null, lore: [], loreFolders: [], assets: [], pack: { regex: [], triggers: [off], toggles: [] } });
    const result = await readBackup([bin([['database.risudat', database({ characters: [], modules: [source] })]])]);
    if (!result.ok) throw new Error(result.failure.kind);
    const module = await result.backup.module(result.backup.catalog.modules[0]!.key);
    expect(module.pack.triggers).toEqual([off]);
  });

  it('reads a module with its pictures from the asset storage, and where Risu had it on as Risu ids', async () => {
    const backup = await read();
    const modules = await Promise.all(backup.catalog.modules.map(({ key }) => backup.module(key)));
    const characters = await Promise.all(backup.catalog.characters.map(({ key }) => backup.character(key)));
    expect(modules).toMatchObject([
      {
        name: 'Bell',
        description: 'rings',
        namespace: 'bell',
        risu: 'm1',
        pack: { regex: [{ id: 'regex-0', name: 'ring', find: 'ding', replace: 'dong', stage: 'display', flags: null }] },
        lore: [{ name: 'Bell', keys: ['bell'], content: 'It rings.', constant: true }],
        unsupported: [{ kind: 'missing-asset', count: 1 }],
      },
    ]);
    expect(modules[0]!.assets.map(({ name }) => name)).toEqual(['bell']);
    expect(await modules[0]!.assets[0]!.read()).toEqual(PNG);
    expect(backup.catalog.alwaysModules).toEqual(['m1']);
    expect(characters.map(({ id, modules }) => [id, modules])).toEqual([
      ['sleeper', []],
      ['mira', ['m1', 'm2']],
    ]);
  });

  it('takes the selected persona and the active preset from their live values, without keys, and a persona\'s own module with its MCP and cjs counted unread', async () => {
    const backup = await read();
    const personas = await Promise.all(backup.catalog.personas.map(({ key }) => backup.persona(key)));
    expect(personas.map(({ id, name, alias, description }) => ({ id, name, alias, description }))).toEqual([
      { id: 'p1', name: 'Ann', alias: '', description: 'live' },
      { id: 'p2', name: 'Bob', alias: 'the rich one', description: 'b' },
    ]);
    expect(backup.catalog.personas.map(({ selected }) => selected)).toEqual([true, false]);
    expect(personas[0]!.module).toMatchObject({ name: 'Ann', lore: [{ content: 'A red cape.' }], unsupported: [{ kind: 'mcp', count: 1 }, { kind: 'cjs', count: 1 }] });
    expect(personas[1]!.module).toBeNull();
    expect(await personas[0]!.picture()).toEqual({ bytes: PNG, type: 'image/png' });
    expect(await personas[1]!.picture()).toBeNull();
    const [main, legacy] = await Promise.all(backup.catalog.presets.map(({ key }) => backup.preset(key)));
    expect(main!.result).toMatchObject({ ok: true, prompt: { name: 'Main', blocks: [{ kind: 'text', text: 'live', mark: 'main' }] } });
    expect(legacy).toEqual({ name: 'Legacy', result: { ok: false, failure: { kind: 'no-template' } } });
    // First-run Risu's slot, which never saved the template the database sends.
    const firstRun = await readBackup([backupFile(database({ ...db, botPresets: [{ name: 'Default', mainPrompt: '' }] }))]);
    if (!firstRun.ok) throw new Error(firstRun.failure.kind);
    expect((await firstRun.backup.preset(firstRun.backup.catalog.presets[0]!.key))!.result).toMatchObject({ ok: true, prompt: { name: 'Default', blocks: [{ kind: 'text', text: 'live' }] } });
    expect(JSON.stringify({ catalog: backup.catalog, personas, presets: [main, legacy] })).not.toContain('sk-');
  });
});
