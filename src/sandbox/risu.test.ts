import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { RISU_MAPPED } from '../tool-api/risu-methods';
import { installRisu, risuScript } from './risu';

type Handler = (...args: never[]) => unknown;

function fakeApi({ open = true } = {}) {
  const handlers = new Map<string, Handler>();
  const storage = new Map<string, Hazelle.Json>();
  const menus: { id: string; label: string }[][] = [];
  const missing: string[] = [];
  const edits: [number, string][] = [];
  const added: [Hazelle.Role, string][] = [];
  const said: string[] = [];
  const lore: Omit<Hazelle.LoreEntry, 'owner'>[] = [];
  const variables: [string, string][] = [];
  const messages: Hazelle.Message[] = [
    { index: 0, id: 'm0', version: 'v0', role: 'user', text: 'hello', raw: 'hello', time: 1 },
    { index: 1, id: 'm1', version: 'v1', role: 'char', text: 'hi there', raw: '<b>hi there</b>', time: 2 },
  ];
  const card: Hazelle.Card = {
    id: 'character-1', name: 'Mira', description: 'A sailor', personality: 'calm', scenario: 'harbor', greeting: null, creatorNotes: '', tags: ['sea'],
  };
  const lorebook: Hazelle.LoreEntry[] = [
    { name: 'Port', keys: ['port', 'dock'], text: 'The port.', always: false, on: true, owner: { kind: 'character', id: 'character-1' } },
    { name: 'Weather', keys: [], text: 'Rain.', always: true, on: true, owner: { kind: 'chat', id: 'chat-1' } },
    { name: 'Ships', keys: ['ship'], text: 'Many ships.', always: false, on: false, owner: { kind: 'module', id: 'module-1' } },
  ];
  const account: Hazelle.Account = {
    personas: [{ id: 'p0', name: 'Jin', description: 'A reader', picture: null, current: true }, { id: 'p1', name: 'Rook', description: 'A sailor too', picture: 'data:image/webp;base64,UklG', current: false }],
    characters: [{ id: 'character-1', name: 'Mira' }],
  };
  const setup: Hazelle.Setup = { persona: 'p1', limits: { context: 8000, reply: null }, modules: [{ id: 'module-1', name: 'Harbor', regex: [{ name: 'bold', find: '\\*(.+?)\\*', replace: '<b>$1</b>', stage: 'display', flags: null }] }] };
  const settings: Hazelle.Settings = { image_base: 'none' };
  const model = vi.fn<Hazelle.Chat['model']>(async () => ({ ok: true, text: 'made' }));
  const send = vi.fn<Hazelle.Chat['send']>(async () => ({ ok: true }));
  const editCard = vi.fn<Hazelle.Chat['editCard']>(async () => ({ ok: true }));
  const chat = {
    id: 'chat-1', character: { name: 'Mira', description: 'A sailor' }, persona: null, length: messages.length,
    messages: async () => messages, greeting: async () => null, card: async () => card, lorebook: async () => lorebook, setup: async () => setup,
    edit: (index: number, text: string) => { edits.push([index, text]); }, add: (role: Hazelle.Role, text: string) => { added.push([role, text]); },
    writeLore: (entry: Omit<Hazelle.LoreEntry, 'owner'>) => { lore.push(entry); },
    variables: { set: (name: string, value: string) => { variables.push([name, value]); } },
    model, send, editCard, say: (text: string) => { said.push(text); },
    rendered: async (at: Hazelle.At | null) => (at === null ? { html: '<i>welcome</i>', css: '.b { color: red; }', text: 'welcome' } : at.id === 'm1' ? { html: '<b>hi there</b>', css: '.b { color: red; }', text: 'hi there' } : null),
  } as unknown as Hazelle.Chat;
  const api = {
    api: 1, tool: { name: 'test', author: 'jin', displayName: 'Test', version: '1' }, context: 'frame',
    on: (event: string, handler: Handler) => { handlers.set(event, handler); },
    storage: {
      get: async (key: string) => storage.get(key), set: async (key: string, value: Hazelle.Json) => { storage.set(key, value); },
      delete: async (key: string) => { storage.delete(key); }, keys: async () => [...storage.keys()], onChange: () => () => {},
    },
    settings: async () => settings, setSetting: async (key: string, value: string | number | boolean) => { settings[key] = value; }, account: async () => account, post: () => {}, page: null,
    frame: { chat: async () => (open ? chat : null), show: vi.fn(), hide: vi.fn(), menu: (items: { id: string; label: string }[]) => { menus.push(items); }, missing: (name: string) => { missing.push(name); } },
  } as unknown as Hazelle.Api;
  const fire = (event: string, ...args: unknown[]) => (handlers.get(event) as (...args: unknown[]) => unknown)(...args);
  return { api, chat, card, handlers, storage, menus, missing, edits, added, said, lore, variables, model, send, editCard, settings, fire };
}
const install = (fake: ReturnType<typeof fakeApi>, scope: Record<string, unknown> = {}) => {
  installRisu(fake.api, scope);
  return scope as Record<string, unknown> & { Risuai: Record<string, (...args: never[]) => Promise<unknown>> & Record<string, Record<string, (...args: never[]) => Promise<unknown>>> };
};

describe('the Risu adapter', () => {
  it('names the open chat by stable indices that getChatFromIndex answers with its messages as written, and nothing else', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const characterIndex = await Risuai.getCurrentCharacterIndex!() as number;
    const chatIndex = await Risuai.getCurrentChatIndex!() as number;
    expect((await Risuai.getDatabase!(['characters'] as never) as { characters: { chaId: string }[] }).characters[characterIndex]?.chaId).toBe('character-1');
    expect(await Risuai.getChatFromIndex!(characterIndex as never, chatIndex as never)).toEqual({
      id: 'chat-1', message: [{ role: 'user', data: 'hello', time: 1, chatId: 'm0' }, { role: 'char', data: '<b>hi there</b>', time: 2, chatId: 'm1' }],
      localLore: [{ comment: 'Weather', key: '', content: 'Rain.', alwaysActive: true, disabled: false }],
    });
    expect(await Risuai.getChatFromIndex!(characterIndex as never, (chatIndex + 1) as never)).toBeNull();
    await Risuai.setChatToIndex!(characterIndex as never, chatIndex as never, { message: [{ role: 'user', data: 'edited' }, { role: 'char', data: '<b>hi there</b>' }, { role: 'user', data: 'more' }] } as never);
    expect(fake.edits).toEqual([[0, 'edited']]);
    expect(fake.added).toEqual([['user', 'more']]);
    expect(await Risuai.getCharacter!()).toMatchObject({ chaId: 'character-1', name: 'Mira', desc: 'A sailor', firstMessage: '', type: 'character', globalLore: [{ key: 'port, dock', content: 'The port.' }] });

    const closed = install(fakeApi({ open: false })).Risuai;
    expect(await closed.getCurrentChatIndex!()).toBe(-1);
    expect(await closed.getChatFromIndex!(-1 as never, -1 as never)).toBeNull();
    expect(await closed.getCharacter!()).toBeNull();
  });

  it('writes back the localLore it changed and scriptstate\'s variables, and tells 점검 of what it cannot write', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const at = [await Risuai.getCurrentCharacterIndex!(), await Risuai.getCurrentChatIndex!()] as never[];
    const chat = await Risuai.getChatFromIndex!(...at) as { localLore: Record<string, unknown>[] };
    const save = { key: '', comment: 'save', content: '{"turn":1}', mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, useRegex: false };
    await Risuai.setChatToIndex!(...at, { ...chat, name: 'Run', scriptstate: { $sh_Player_Name: 'Jin', $sh_Turn: 2, plain: 'x' }, localLore: [...chat.localLore, save] } as never);
    expect(fake.lore).toEqual([{ name: 'save', keys: [], text: '{"turn":1}', always: false, on: true }]);
    expect(fake.variables).toEqual([['sh_Player_Name', 'Jin'], ['sh_Turn', '2']]);
    expect(fake.missing).toEqual(['setChatToIndex:name', 'setChatToIndex:scriptstate.plain']);
    await Risuai.setChatToIndex!(...at, { ...chat, localLore: [] } as never);
    expect(fake.missing).toContain('setChatToIndex:localLore.remove');
  });

  it('writes only the character\'s fields that changed, skips a refused write as Risu does, and tells a key it cannot write', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const held = await Risuai.getCharacter!() as Record<string, unknown>;
    await Risuai.setCharacter!(held as never);
    expect(fake.editCard).not.toHaveBeenCalled();
    await Risuai.setCharacter!({ ...held, desc: 'A captain', firstMessage: 'Ahoy', globalLore: [], emotionImages: [] } as never);
    expect(fake.editCard).toHaveBeenCalledWith({ description: 'A captain', greeting: 'Ahoy' });
    expect(fake.missing).toEqual(['setCharacter:globalLore', 'setCharacter:emotionImages']);
    fake.editCard.mockResolvedValueOnce({ ok: false, reason: 'not-allowed' });
    await expect(Risuai.setChar!({ ...held, name: 'Mia' } as never)).resolves.toBeUndefined();
    fake.editCard.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    await expect(Risuai.setCharacterToIndex!(0 as never, { ...held, tags: ['sea', 'ship'] } as never)).rejects.toThrow("Risu API 'setCharacterToIndex' failed in Hazelle: failed");
    await expect(Risuai.setCharacterToIndex!(1 as never, held as never)).rejects.toThrow('reaches only the open chat\'s character');
  });

  it('takes back the database as getDatabase read it, and fails a key that changed, told to 점검', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const db = await Risuai.getDatabase!() as Record<string, unknown>;
    await Risuai.setDatabase!(db as never);
    await Risuai.setDatabaseLite!({ ...db, plugins: [{ name: 'other' }] } as never);
    await expect(Risuai.setDatabase!({ ...db, username: 'Ann', temperature: 70 } as never)).rejects.toThrow("Risu API 'setDatabase' cannot write username, temperature in Hazelle");
    expect(fake.missing).toEqual(['setDatabase:username', 'setDatabase:temperature']);
  });

  it('sends as the user through the chat, answering false when models are refused as Risu does its permission', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    expect(await Risuai.sendChat!('' as never)).toBe(true);
    expect(fake.send).toHaveBeenCalledWith('');
    fake.send.mockResolvedValueOnce({ ok: false, reason: 'not-allowed' });
    expect(await Risuai.sendChat!('go' as never)).toBe(false);
    fake.send.mockResolvedValueOnce({ ok: false, reason: 'busy' });
    await expect(Risuai.sendChat!('go' as never)).rejects.toThrow('A chat is already in progress');
  });

  it('relabels a button registered again under its id and runs the latest callback when pressed', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const first = vi.fn();
    const second = vi.fn();
    await Risuai.registerButton!({ name: '낚시하기', id: 'cast' } as never, first as never);
    await Risuai.registerButton!({ name: '낚시하기 (새 업적 1)', id: 'cast' } as never, second as never);
    expect(fake.menus.at(-1)).toEqual([{ id: 'cast', label: '낚시하기 (새 업적 1)' }]);
    fake.fire('menu', fake.chat, 'cast');
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
    expect(first).not.toHaveBeenCalled();
    await Risuai.unregisterUIPart!('cast' as never);
    expect(fake.menus.at(-1)).toEqual([]);
  });

  it('lists a button a plugin offers in two Risu places once, and the other once the first is gone', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const panel = vi.fn();
    await Risuai.registerButton!({ name: 'SimCore', location: 'chat', id: 'chat' } as never, panel as never);
    await Risuai.registerButton!({ name: 'SimCore', location: 'hamburger', id: 'side' } as never, panel as never);
    expect(fake.menus.at(-1)).toEqual([{ id: 'chat', label: 'SimCore' }]);
    fake.fire('menu', fake.chat, 'chat');
    await vi.waitFor(() => expect(panel).toHaveBeenCalledTimes(1));
    await Risuai.unregisterUIPart!('chat' as never);
    expect(fake.menus.at(-1)).toEqual([{ id: 'side', label: 'SimCore' }]);
  });

  it('runs a plugin whose top level awaits, as Risu does', async () => {
    const fake = fakeApi();
    const scope = install(fake);
    await runInNewContext(risuScript("await risuai.registerButton({ name: '용사', location: 'chat', id: 'hero' }, () => {}); // last line"), scope);
    expect(fake.menus.at(-1)).toEqual([{ id: 'hero', label: '용사' }]);
  });

  it('maps exactly the shared list; any other name throws by name and is told to 점검 once', async () => {
    const fake = fakeApi();
    const scope = install(fake);
    const { Risuai } = scope;
    for (const name of RISU_MAPPED) expect(Risuai[name], name).toBeDefined();
    await expect(Risuai.readInlay!()).rejects.toThrow("Risu API 'readInlay' is not available in Hazelle");
    await expect(Risuai.readInlay!()).rejects.toThrow();
    expect(typeof Risuai.addProvider).toBe('undefined');
    await expect(Risuai.addRisuReplacer!('beforeTranslate' as never, (() => []) as never)).rejects.toThrow("'addRisuReplacer:beforeTranslate'");
    expect((Risuai as Record<string, unknown>).then).toBeUndefined();
    expect(fake.missing).toEqual(['readInlay', 'addProvider', 'addRisuReplacer:beforeTranslate']);
    expect(await Risuai.getRuntimeInfo!()).toEqual({ apiVersion: '3.0', platform: 'hazelle', saveMethod: 'account' });
    expect([Risuai.apiVersion, Risuai.apiVersionCompatibleWith]).toEqual(['3.0', ['3.0']]);
    await expect(Risuai.checkCharOrder!()).resolves.toBeUndefined();
  });

  it('says why a name with nothing in Hazelle fails, and why staticModel does', async () => {
    const { Risuai } = install(fakeApi());
    await expect(Risuai.addTTSPreprocessor!((() => {}) as never)).rejects.toThrow("Risu API 'addTTSPreprocessor' is not available in Hazelle: Hazelle has no text-to-speech");
    expect(await Risuai.runLLMModel!({ messages: [], mode: 'model', staticModel: 'gemini-2.5-pro' } as never)).toEqual({ type: 'fail', result: 'staticModel names a RisuAI model; Hazelle sends to the chat\'s own models only' });
  });

  it('finds in getRootDocument the chat screen\'s rows, greeting at -1, a body by chatId as CSS.escape writes it or by index, and the bot\'s sheet', async () => {
    type Found = { getOuterHTML(): Promise<string>; getInnerHTML(): Promise<string>; innerText(): Promise<string>; getAttribute(name: string): Promise<string | null>; scrollIntoView(): Promise<void> };
    type Safe<T> = { at(index: number): Promise<T | undefined>; length(): Promise<number> };
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const root = await Risuai.getRootDocument!() as { querySelector(selector: string): Promise<Found | null>; querySelectorAll(selector: string): Promise<Safe<Found>> };
    expect(await (await root.querySelectorAll('style')).length()).toBe(0);
    const body = (await root.querySelector('.risu-chat[data-chat-id="\\6d 1"] .chattext:not(.hidden)'))!;
    expect(await body.getOuterHTML()).toBe('<div class="chattext"><b>hi there</b></div>');
    expect(await body.innerText()).toBe('hi there');
    expect(await (await root.querySelector('[data-chat-index="1"] .chattext'))!.innerText()).toBe('hi there');
    expect(await (await root.querySelector('[data-chat-index="-1"] .chattext'))!.innerText()).toBe('welcome');
    const row = (await root.querySelector('.risu-chat[data-chat-index][data-chat-index="1"]'))!;
    expect(await row.getAttribute('data-chat-id')).toBe('m1');
    await expect(row.scrollIntoView()).resolves.toBeUndefined();
    const rows = await root.querySelectorAll('.default-chat-screen .risu-chat[data-chat-index]');
    expect(await rows.length()).toBe(2);
    expect(await (await rows.at(0))!.getAttribute('data-chat-index')).toBe('-1');
    expect(await (await root.querySelector('.default-chat-screen'))!.getInnerHTML()).toBe('<div class="risu-chat" data-chat-index="-1" data-chat-id=""><div class="chattext"><i>welcome</i></div></div><div class="risu-chat" data-chat-index="1" data-chat-id="m1"><div class="chattext"><b>hi there</b></div></div>');
    expect(await Promise.all((await Risuai.unwarpSafeArray!(await root.querySelectorAll('style') as never) as Found[]).map((sheet) => sheet.getOuterHTML()))).toEqual(['<style>.b { color: red; }</style>']);
    expect(await (await root.querySelectorAll('link[rel~="stylesheet"]')).length()).toBe(0);
    expect(await root.querySelector('[data-chat-index="0"] .chattext')).toBeNull();
    expect(await root.querySelector('body')).toBeNull();
    expect(fake.missing).toEqual(['getRootDocument:page']);
  });

  it('saves an asset at Risu\'s path and reads it back with or without the assets/ prefix, refusing other folders', async () => {
    const fake = fakeApi();
    const kept = new Map<string, Uint8Array>();
    Object.assign(fake.api, { assets: { save: async (bytes: Uint8Array) => { kept.set('abc', bytes); return 'abc'; }, read: async (name: string) => kept.get(name) ?? null } });
    const { Risuai } = install(fake);
    const bytes = new Uint8Array([137, 80, 78, 71]);
    expect(await Risuai.saveAsset!(bytes as never)).toBe('assets/abc.png');
    expect(await Risuai.readImage!('assets/abc.png' as never)).toBe(bytes);
    expect(await Risuai.readImage!('abc.png' as never)).toBe(bytes);
    expect(await Risuai.readImage!('assets/other.png' as never)).toBeNull();
    expect(await Risuai.readImage!('abc' as never)).toBeNull();
    await expect(Risuai.readImage!('assets/../abc.png' as never)).rejects.toThrow('readImage path');
    await expect(Risuai.readImage!('..\\abc.png' as never)).rejects.toThrow('readImage path');
  });

  it('chains afterRequest replacers over the reply and answers runLLMModel in Risu shape', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    await Risuai.addRisuReplacer!('afterRequest' as never, ((content: string, type: string) => `${content} [${type}]`) as never);
    await Risuai.addRisuReplacer!('afterRequest' as never, (async (content: string) => content.toUpperCase()) as never);
    expect(await fake.fire('replying', fake.chat, 'reply')).toBe('REPLY [MODEL]');
    expect(await Risuai.runLLMModel!({ messages: [{ role: 'user', content: 'hi' }], mode: 'otherAx' } as never)).toEqual({ type: 'success', result: 'made' });
    expect(fake.model).toHaveBeenCalledWith('aux', [{ role: 'user', content: 'hi' }]);
    fake.model.mockResolvedValueOnce({ ok: false, reason: 'not-allowed' });
    expect(await Risuai.runLLMModel!({ messages: [], mode: 'model' } as never)).toEqual({ type: 'fail', result: 'not-allowed' });
    expect(fake.model).toHaveBeenLastCalledWith('main', []);
  });

  it('keeps pluginStorage, the local plugin storage and safeLocalStorage apart in the one tool storage', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    await Risuai.pluginStorage!.setItem!('k' as never, 'plugin' as never);
    await (await (Risuai.getLocalPluginStorage!() as Promise<Record<string, (...args: never[]) => Promise<unknown>>>)).setItem!('k' as never, 'local' as never);
    await Risuai.safeLocalStorage!.setItem!('k' as never, 'safe' as never);
    expect(await Risuai.pluginStorage!.getItem!('k' as never)).toBe('plugin');
    expect(await Risuai.safeLocalStorage!.getItem!('k' as never)).toBe('safe');
    expect(await Risuai.pluginStorage!.getItem!('missing' as never)).toBeNull();
    expect(await Risuai.pluginStorage!.keys!()).toEqual(['k']);
    expect(fake.storage.size).toBe(3);
    await Risuai.pluginStorage!.setItem!('draft' as never, { name: 'Leon', notes: undefined } as never);
    expect(await Risuai.pluginStorage!.getItem!('draft' as never)).toStrictEqual({ name: 'Leon' });
  });

  it('hands beforeRequest the request in Risu shape after the process handlers, and maps its answer back', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    expect(fake.handlers.has('requesting')).toBe(false);
    await Risuai.addRisuScriptHandler!('process' as never, ((text: string) => `${text}!`) as never);
    const seen: unknown[] = [];
    await Risuai.addRisuReplacer!('beforeRequest' as never, ((messages: { role: string; content: string }[], type: string) => {
      seen.push(structuredClone(messages), type);
      return [...messages, { role: 'system', content: 'note' }];
    }) as never);
    const request: Hazelle.RequestMessage[] = [{ role: 'system', content: 'rules', cache: true }, { role: 'user', content: 'hello', message: 'm0' }];
    expect(await fake.fire('requesting', fake.chat, request)).toEqual([{ role: 'system', content: 'rules', cache: true }, { role: 'user', content: 'hello!', message: 'm0' }, { role: 'system', content: 'note' }]);
    expect(seen).toEqual([[{ role: 'system', content: 'rules', cachePoint: true }, { role: 'user', content: 'hello!', memo: 'm0' }], 'model']);
  });

  it('fails a beforeRequest answer Hazelle cannot send and tells a field it cannot carry', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    const replacer = vi.fn((messages: object[]): object[] => messages.map((message) => ({ ...message, name: 'Mira' })));
    await Risuai.addRisuReplacer!('beforeRequest' as never, replacer as never);
    expect(await fake.fire('requesting', fake.chat, [{ role: 'user', content: 'hi' }])).toEqual([{ role: 'user', content: 'hi' }]);
    expect(fake.missing).toEqual(['addRisuReplacer:beforeRequest.name']);
    replacer.mockReturnValueOnce([{ role: 'function', content: 'x' }]);
    await expect(fake.fire('requesting', fake.chat, [{ role: 'user', content: 'hi' }])).rejects.toThrow('role function');
  });

  it('runs each script handler mode on its own stage, output after afterRequest', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    await Risuai.addRisuScriptHandler!('display' as never, ((text: string) => text.toUpperCase()) as never);
    await Risuai.addRisuScriptHandler!('input' as never, ((text: string) => `[${text}]`) as never);
    await Risuai.addRisuScriptHandler!('output' as never, ((text: string) => `${text} (out)`) as never);
    await Risuai.addRisuReplacer!('afterRequest' as never, ((text: string) => `${text} (after)`) as never);
    expect(await fake.fire('showing', fake.chat, [{ at: null, text: 'hi' }, { at: { index: 0, id: 'm0', version: 'v0' }, text: 'there' }])).toEqual(['HI', 'THERE']);
    expect(await fake.fire('sending', fake.chat, 'go')).toBe('[go]');
    expect(await fake.fire('replying', fake.chat, 'done')).toBe('done (after) (out)');
    await Risuai.addRisuScriptHandler!('display' as never, (() => null) as never);
    expect(await fake.fire('showing', fake.chat, [{ at: null, text: 'kept' }])).toEqual(['KEPT']);
  });

  it('builds the database keys asked for, leaves out one Risu never answers, and tells one it does not build', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    expect(await Risuai.getDatabase!(['personas', 'selectedPersona', 'presetRegex', 'temperature'] as never)).toEqual({
      personas: [{ id: 'p0', name: 'Jin', personaPrompt: 'A reader', icon: '' }, { id: 'p1', name: 'Rook', personaPrompt: 'A sailor too', icon: 'data:image/webp;base64,UklG' }], selectedPersona: 1,
    });
    expect(fake.missing).toEqual(['getDatabase:temperature']);
    expect(await Risuai.getDatabase!()).toEqual({
      username: 'Rook', personaPrompt: 'A sailor too', personas: expect.any(Array), selectedPersona: 1, characters: [{ chaId: 'character-1', type: 'character', name: 'Mira' }],
      maxContext: 8000, enabledModules: ['module-1'], moduleIntergration: '',
      modules: [{
        id: 'module-1', name: 'Harbor', lorebook: [{ comment: 'Ships', key: 'ship', content: 'Many ships.', alwaysActive: false, disabled: true }],
        regex: [{ comment: 'bold', in: '\\*(.+?)\\*', out: '<b>$1</b>', type: 'editdisplay', ableFlag: false, flag: '' }],
      }],
    });
    const closed = install(fakeApi({ open: false })).Risuai;
    expect(await closed.getDatabase!(['selectedPersona', 'maxContext', 'modules', 'moduleIntergration'] as never)).toEqual({ selectedPersona: 0 });
  });

  it('reads the open chat\'s lorebook entries in Risu shape and its character by the current index only', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    expect(await Risuai.getCurrentLorebookEntries!()).toEqual([
      { comment: 'Port', key: 'port, dock', content: 'The port.', alwaysActive: false, disabled: false },
      { comment: 'Weather', key: '', content: 'Rain.', alwaysActive: true, disabled: false },
      { comment: 'Ships', key: 'ship', content: 'Many ships.', alwaysActive: false, disabled: true },
    ]);
    const current = await Risuai.getCurrentCharacterIndex!() as number;
    expect(await Risuai.getCharacterFromIndex!(current as never)).toMatchObject({ chaId: 'character-1', globalLore: [{ comment: 'Port' }] });
    expect(await Risuai.getCharacterFromIndex!((current + 1) as never)).toBeNull();
  });

  it('writes an argument through the tool settings', async () => {
    const fake = fakeApi();
    const { Risuai } = install(fake);
    await Risuai.setArgument!('image_base' as never, 'https://example.com' as never);
    expect(await Risuai.getArgument!('image_base' as never)).toBe('https://example.com');
  });

  it('answers nativeFetch with a Response RisuPot and DiaryLog read, and turns a refusal into a failed fetch', async () => {
    const fake = fakeApi();
    const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
    const fetch = vi.fn<Hazelle.Chat['fetch']>()
      .mockResolvedValueOnce({ ok: true, status: 401, headers: [['content-type', 'application/json']], body: bytes('{"error":{"message":"expired"}}') })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: [['content-type', 'image/png']], body: new Uint8Array([137, 80]).buffer })
      .mockResolvedValueOnce({ ok: true, status: 204, headers: [], body: new ArrayBuffer(0) })
      .mockResolvedValueOnce({ ok: false, reason: 'refused', code: 'not-public' });
    Object.assign(fake.chat, { fetch });
    const { Risuai } = install(fake);
    const nativeFetch = Risuai.nativeFetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    const signal = new AbortController().signal;
    // RisuPot: ok and status on a refusal, then the body as text for its detail, as JSON once read.
    const refused = await nativeFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer k' }, body: '{"a":1}', signal, redirect: 'error' });
    expect(fetch).toHaveBeenCalledWith('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer k' }, body: '{"a":1}', signal });
    expect([refused.ok, refused.status]).toEqual([false, 401]);
    expect(JSON.parse(await refused.text())).toEqual({ error: { message: 'expired' } });
    // DiaryLog: a picture's bytes and its type.
    const picture = await nativeFetch('https://img.youtube.com/vi/x/0.jpg', { method: 'GET' });
    expect([picture.ok, picture.headers.get('content-type'), [...new Uint8Array(await picture.arrayBuffer())]]).toEqual([true, 'image/png', [137, 80]]);
    expect((await nativeFetch('https://api.example.com/empty')).status).toBe(204);
    await expect(nativeFetch('https://10.0.0.1/')).rejects.toThrow(new TypeError('Failed to fetch: refused (not-public)'));
    await expect(nativeFetch('https://api.example.com/', { method: 'PUT', body: 'x' })).rejects.toThrow(TypeError);
    await expect(nativeFetch('https://api.example.com/', { method: 'POST', body: new Uint8Array([1]) })).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(4);
  });
});

// The acceptance plugins (research/risu-plugin-adapter-plan.md §7 phases A and B) live in the private docs repo, beside
// this checkout; without it these tests skip.
const PORTS = new URL('../../docs/research/ports/', import.meta.url);
const port = (path: string) => new URL(path, PORTS);
const available = existsSync(port('risuai-side-phone/Side_Phone.js')) && existsSync(port('risu-fishing/risu_fishing.js'));
const availableB = existsSync(port('risupot/risupot_v2_0_2.js')) && existsSync(port('diarylog/DiaryLog.min.js'));

// Enough of a page for a plugin's load path: every property, call and construction answers another stand-in.
function standIn(): unknown {
  const target = function () {};
  const proxy: unknown = new Proxy(target, {
    get: (_target, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : proxy),
    set: () => true,
    apply: () => proxy,
    construct: () => proxy as object,
  });
  return proxy;
}

const load = async (path: string) => {
  const fake = fakeApi();
  const scope: Record<string, unknown> = {
    document: standIn(), window: standIn(), navigator: standIn(), Image: standIn(), console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, crypto, confirm: () => false, prompt: () => null,
    TextEncoder, TextDecoder, URL, URLSearchParams, AbortController, AbortSignal, queueMicrotask, structuredClone, performance, location: standIn(), localStorage: standIn(),
  };
  installRisu(fake.api, scope);
  await runInNewContext(risuScript(readFileSync(port(path), 'utf8')), scope, { timeout: 20_000 });
  return fake;
};

describe.runIf(available)('the acceptance plugins, unmodified', () => {
  it('loads Side Phone and registers its button and its afterRequest replacer, which leaves the reply as it is', async () => {
    const fake = await load('risuai-side-phone/Side_Phone.js');
    await vi.waitFor(() => expect(fake.menus.at(-1)).toEqual([{ id: 'btn-secret-phone', label: '사이드폰' }]));
    expect(await fake.fire('replying', fake.chat, 'the reply')).toBe('the reply');
    expect(fake.missing).toEqual([]);
  });

  it('loads Fishing and registers its buttons, its setting and its hooks', async () => {
    const fake = await load('risu-fishing/risu_fishing.js');
    await vi.waitFor(() => expect(fake.menus.at(-1)).toEqual([{ id: 'risu-fishing-cast', label: '낚시하기' }, { id: 'risu-fishing-dex', label: '낚시 도감' }]));
    expect(await fake.fire('replying', fake.chat, 'the reply')).toBe('the reply');
    await fake.fire('reply', fake.chat, { index: 1, id: 'm1', version: 'v1' });
    await vi.waitFor(() => expect(fake.storage.has('plugin:state_v1')).toBe(true), { timeout: 2000 });
    expect(fake.missing).toEqual([]);
  });
});

describe.runIf(availableB)('the phase B acceptance plugins, unmodified', () => {
  it('loads RisuPot, whose beforeRequest replacer adds its notes and keeps the chat message it was given', async () => {
    const fake = await load('risupot/risupot_v2_0_2.js');
    await vi.waitFor(() => expect(fake.handlers.has('requesting')).toBe(true), { timeout: 5000 });
    expect(fake.menus.at(-1)).toEqual([{ id: 'risupot-open', label: '리수폿 설정' }]);
    const request: Hazelle.RequestMessage[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hello', message: 'm0' }];
    const sent = await fake.fire('requesting', fake.chat, request) as Hazelle.RequestMessage[];
    expect(sent[0]).toEqual(request[0]);
    expect(sent.at(-1)).toEqual(request[1]);
    expect(sent.slice(1, -1).every(({ role, content }) => role === 'system' && content.includes('RISUPOT'))).toBe(true);
    // It reaches for the app's page past a drawn message, which stays declined, and goes on without it; its scope id on
    // the chat is not kept.
    expect(fake.missing).toEqual(['getRootDocument:page', 'setChatToIndex:risupotWikiScopeId']);
  }, 30_000);

  // Opening its screen needs a real document, which only a browser run gives.
  it('loads DiaryLog and registers its entry', async () => {
    const fake = await load('diarylog/DiaryLog.min.js');
    await vi.waitFor(() => expect(fake.menus.at(-1)).toEqual([{ id: expect.any(String), label: 'DiaryLog' }]), { timeout: 5000 });
    expect(fake.missing).toEqual([]);
  }, 30_000);
});
