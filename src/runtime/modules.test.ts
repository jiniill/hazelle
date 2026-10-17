import { describe, expect, it } from 'vitest';
import { fold } from '../model/chat';
import { startChat } from './chat-log';
import { projectGreetings } from './greetings';
import { editModule, importModule, modulesOf, pairWithPrompts, replaceModules, sameNamespace, setCharacterModule, setModuleAlways, setModuleAt, setModuleDeleted, setPromptModule } from './modules';
import { addPrompt, chatPrompt, ofSort, savePreset } from './prompts';
import { convertPreset } from '../engine/import/preset';
import { answerable, saying, stubRelay, testServer } from './testing';
import { blankCard } from '../engine/import/card';
import { evaluateChat, packsOf, togglesOf } from './chat-context';
import { SETTINGS_ID } from '../model/settings';
import { takeTurn } from './turn';

const server = testServer();

const lore = { name: 'Bell', keys: [], secondaryKeys: [], content: 'A bell rings at noon.', enabled: true, constant: true, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 10, priority: null, position: null, folder: null };

describe('modules', () => {
  it("works on a chat after the character's own pack while on for the character or always, and not once deleted", () =>
    server.withSession(async (session) => {
      const { store, files } = session;
      await answerable(session);
      const card = { ...blankCard('루나'), greetings: ['the lamp'], regex: [{ id: 'regex-0', name: 'own', find: 'lamp', replace: 'LAMP', stage: 'display' as const, flags: null }] };
      const character = await store.create('character', { card, folder: null, loreFolders: [] });
      if (!character.ok) throw new Error(character.error);
      const pack = {
        regex: [{ id: 'regex-0', name: 'after', find: 'LAMP', replace: 'STAR', stage: 'display' as const, flags: null }],
        triggers: [{ kind: 'lua' as const, id: 'trigger-0', name: 'main', code: `listenEdit('editOutput', function(id, value) return value .. ' (module)' end)` }],
        background: '<style>.bell { color: red }</style>',
        toggles: [{ key: 'ring', label: 'Ring', kind: 'check' as const, default: '0' as const }],
      };
      const added = await importModule(store, files, { name: 'Bell', description: '', namespace: 'bell', risu: null, pack, lore: [lore], loreFolders: [], assets: [], unsupported: [] }, () => {});
      if (!added.ok) throw new Error(added.error);
      const module = added.data.id;

      const chat = crypto.randomUUID();
      await server.hold(store, chat);
      await startChat(store, chat, { title: null, character: character.data.id, models: {} }, projectGreetings(card.greetings, [crypto.randomUUID()], 0));
      const value = () => store.get('chat', chat)!.value;
      const shown = () => evaluateChat(session, chat, value(), fold(store.children('entry', chat)));
      const toggles = () => togglesOf(store, value(), chatPrompt(store, value())).declared.map(({ key }) => key);
      expect((await shown()).texts).toEqual(['the LAMP']);

      await setCharacterModule(store, character.data.id, module, true);
      expect(await shown()).toMatchObject({ texts: ['the STAR'], css: '.bell { color: red }' });
      expect(toggles()).toContain('ring');
      const log = stubRelay(() => saying('noon'));
      expect(await takeTurn(session, chat, { kind: 'send', text: 'hi' })).toBeNull();
      await expect.poll(async () => (await shown()).texts.at(-1)).toBe('noon (module)');
      expect(log[0]!.sent.body).toContain('A bell rings at noon.');

      await setCharacterModule(store, character.data.id, module, false);
      expect((await shown()).texts[0]).toBe('the LAMP');
      await setModuleAlways(store, module, true);
      expect((await shown()).texts[0]).toBe('the STAR');

      await setModuleDeleted(store, module, Date.now());
      expect((await shown()).texts[0]).toBe('the LAMP');
      expect(modulesOf(store)).toEqual([]);
      await setModuleDeleted(store, module, null);
      expect((await shown()).texts[0]).toBe('the STAR');
    }));

  it("orders a chat's packs as its character's own, then 항상, then its prompt's, then its character's, then its persona's, each once", async () => {
    const { store, files } = await server.account();
    const module = async (name: string) => {
      const added = await importModule(store, files, { name, description: '', namespace: null, risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] }, () => {});
      if (!added.ok) throw new Error(added.error);
      return added.data.id;
    };
    const [always, both, own, worn] = [await module('항상'), await module('둘 다'), await module('캐릭터'), await module('페르소나')];
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [], modules: [own, both] });
    const prompt = await addPrompt(store, '짝', 'conversation');
    if (!character.ok || !prompt.ok || !ofSort(prompt.data, 'conversation')) throw new Error('fixture');
    await setModuleAlways(store, always, true);
    await setPromptModule(store, prompt.data, both, true);
    await setPromptModule(store, prompt.data, always, true);
    const persona = await store.create('persona', { name: '나', description: '', picture: null });
    if (!persona.ok) throw new Error(persona.error);
    await setModuleAt(store, { kind: 'persona', id: persona.data.id }, worn, true);
    await setModuleAt(store, { kind: 'persona', id: persona.data.id }, own, true);
    expect(packsOf(store, { character: character.data.id, prompt: prompt.data.id, persona: persona.data.id }).map(({ id }) => id)).toEqual([character.data.id, always, both, own, worn]);
  });

  it('puts a new version where each older one of its namespace is on, and deleting it and restoring them undoes that', async () => {
    const { store, files } = await server.account();
    const module = async (name: string, namespace: string | null) => {
      const added = await importModule(store, files, { name, description: '', namespace, risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] }, () => {});
      if (!added.ok) throw new Error(added.error);
      return added.data.id;
    };
    const [first, second, other] = [await module('소악마 1', '소악마'), await module('소악마 2', '소악마'), await module('에셋', null)];
    const character = await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [], modules: [other, first] });
    const persona = await store.create('persona', { name: '나', description: '', picture: null, modules: [second] });
    const prompt = await addPrompt(store, '짝', 'conversation');
    if (!character.ok || !persona.ok || !prompt.ok || !ofSort(prompt.data, 'conversation')) throw new Error('fixture');
    await setPromptModule(store, prompt.data, first, true);
    await setModuleAlways(store, second, true);
    const chat = { character: character.data.id, prompt: prompt.data.id, persona: persona.data.id };
    const on = () => packsOf(store, chat).map(({ id }) => id).slice(1);

    expect(sameNamespace(store, '소악마').map(({ id }) => id).sort()).toEqual([first, second].sort());
    const fresh = await module('소악마 3', '소악마');
    await setCharacterModule(store, character.data.id, fresh, true);
    expect(await replaceModules(store, fresh, [first, second])).toEqual({ ok: true, data: 4 });
    expect(store.get('character', character.data.id)!.value.modules).toEqual([other, fresh, first]);
    expect(store.get('settings', SETTINGS_ID)!.value.modules).toEqual([fresh, second]);
    expect(on()).toEqual([fresh, other]);
    expect(sameNamespace(store, '소악마').map(({ id }) => id)).toEqual([fresh]);

    await Promise.all([setModuleDeleted(store, fresh, Date.now()), setModuleDeleted(store, first, null), setModuleDeleted(store, second, null)]);
    expect(on()).toEqual([second, first, other]);
  });

  it('renames a module and rewrites its description, keeping its pack', async () => {
    const { store, files } = await server.account();
    const added = await importModule(store, files, { name: 'Bell', description: '', namespace: 'bell', risu: null, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] }, () => {});
    if (!added.ok) throw new Error(added.error);
    await editModule(store, added.data.id, { name: '종', description: '울려요' });
    expect(store.get('module', added.data.id)!.value).toMatchObject({ name: '종', description: '울려요', namespace: 'bell' });
  });

  it("pairs a preset's prompt with the modules it names, the one already here at import and the one that comes after", async () => {
    const { store, files } = await server.account();
    const module = (name: string, namespace: string, risu: string | null) => ({ name, description: '', namespace, risu, pack: { regex: [], triggers: [], toggles: [] }, lore: [], loreFolders: [], assets: [], unsupported: [] });
    const bell = await importModule(store, files, module('Bell', 'bell', null), () => {});
    if (!bell.ok) throw new Error(bell.error);
    const read = convertPreset({ name: '짝', promptTemplate: [], moduleIntergration: 'bell, risu-chime' });
    if (!read.ok) throw new Error(read.failure.kind);
    const saved = await savePreset(store, read);
    if (!saved.ok) throw new Error(saved.error);
    expect(saved.data).toMatchObject({ paired: [bell.data.id], waiting: ['risu-chime'] });

    const chime = await importModule(store, files, module('Chime', 'chime', 'risu-chime'), () => {});
    if (!chime.ok) throw new Error(chime.error);
    const paired = await pairWithPrompts(store, chime.data.id, { risu: 'risu-chime', namespace: 'chime' });
    expect(paired.ok && paired.data.map(({ id }) => id)).toEqual([saved.data.id]);
    expect(store.get('prompt', saved.data.id)!.value).toMatchObject({ companions: ['bell', 'risu-chime'], modules: [bell.data.id, chime.data.id] });
  });

  it("puts a preset's regex in a module on for its prompt, counting the one Risu had switched off", async () => {
    const { store } = await server.account();
    const read = convertPreset({ name: '핑퐁', promptTemplate: [], regex: [{ comment: '따옴표', in: '"', out: '“', type: 'editoutput', ableFlag: false }, { comment: '꺼짐', in: 'a', out: 'b', type: 'disabled' }] });
    if (!read.ok) throw new Error(read.failure.kind);
    expect(read.unsupported).toContainEqual({ kind: 'regex-off', count: 1 });
    const saved = await savePreset(store, read);
    if (!saved.ok) throw new Error(saved.error);
    expect(store.get('prompt', saved.data.id)!.value).toMatchObject({ modules: [saved.data.made] });
    expect(store.get('module', saved.data.made!)!.value).toMatchObject({ name: '핑퐁 정규식', regex: [{ name: '따옴표', find: '"', replace: '“', stage: 'output' }] });
  });
});
