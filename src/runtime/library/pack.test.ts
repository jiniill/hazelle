import { describe, expect, it } from 'vitest';
import { PLAIN_LUA, type RegexScript } from '../../engine/import/types';
import { addLua, editRegex, moveScript, removeScript, restoreScript, setBackground, setScriptOff } from './pack';
import type { PackOwner } from '../../model/library';
import type { ObjectStore } from '../store/store';
import { testServer } from '../testing';
import { blankCard } from '../../engine/import/card';

const server = testServer();

const script = (id: string, stage: RegexScript['stage']): RegexScript => ({ id, name: id, find: id, replace: '', stage, flags: null });
const REGEX = [script('a', 'display'), script('b', 'output'), script('c', 'display')];

async function character(store: ObjectStore): Promise<PackOwner> {
  const created = await store.create('character', { card: { ...blankCard('루나'), regex: REGEX }, folder: null, loreFolders: [] });
  if (!created.ok) throw new Error(created.error);
  return { kind: 'character', id: created.data.id };
}

const regexOf = (store: ObjectStore, { id }: PackOwner) => store.get('character', id)!.value.card.regex;

describe('pack scripts', () => {
  it('moves a regex script past the nearest one of its stage, and an edit made meanwhile on another device lands on the script it named', async () => {
    const { store, open } = await server.account();
    const owner = await character(store);
    const other = await open();
    await other.pull();
    expect((await moveScript(store, owner, 'regex', 'c', -1, 'a')).ok).toBe(true);
    expect((await editRegex(other, owner, 'a', { find: 'edited' })).ok).toBe(true);
    await store.pull();
    expect(regexOf(store, owner).map(({ id, find }) => `${id}:${find}`)).toEqual(['c:c', 'b:b', 'a:edited']);
  });

  it('applies each change once when it runs again over its own result, as a write whose answer was lost does', async () => {
    const { store, open } = await server.account();
    const owner = await character(store);
    const other = await open();
    const twice = async <T>(change: (on: ObjectStore) => Promise<T>) => {
      await other.pull();
      await change(store);
      return change(other);
    };
    await twice((on) => addLua(on, owner, 'x'));
    await twice((on) => moveScript(on, owner, 'regex', 'c', -1, 'a'));
    const removed = await twice((on) => removeScript(on, owner, 'regex', 'b'));
    expect(removed).toEqual({ ok: true, data: { list: 'regex', script: REGEX[1], at: 1 } });
    if (!removed.ok) return;
    await twice((on) => restoreScript(on, owner, removed.data));
    await store.pull();
    expect(regexOf(store, owner).map(({ id }) => id)).toEqual(['c', 'b', 'a']);
    expect(store.get('character', owner.id)!.value.card.triggers.map(({ id }) => id)).toEqual(['x']);
  });

  it('puts a removed script back where it stood, turned off as it was', async () => {
    const { store } = await server.account();
    const owner = await character(store);
    await setScriptOff(store, owner, 'regex', 'b', true);
    const removed = await removeScript(store, owner, 'regex', 'b');
    if (!removed.ok) throw new Error(removed.error);
    expect(regexOf(store, owner).map(({ id }) => id)).toEqual(['a', 'c']);
    await restoreScript(store, owner, removed.data);
    expect(regexOf(store, owner)).toEqual([REGEX[0], { ...REGEX[1], off: true }, REGEX[2]]);
  });

  it("writes a module's scripts at its top level, as a character's in its card", async () => {
    const { store } = await server.account();
    const created = await store.create('module', { name: 'Bell', description: '', namespace: null, regex: [], triggers: [], toggles: [], loreFolders: [] });
    if (!created.ok) throw new Error(created.error);
    await addLua(store, { kind: 'module', id: created.data.id }, 'lua');
    expect(store.get('module', created.data.id)!.value).toMatchObject({ triggers: [{ kind: 'lua', ...PLAIN_LUA, id: 'lua', name: '', code: '' }] });
  });

  it("keeps a character's background in its card and a module's at its top level, a blank one leaving none", async () => {
    const { store } = await server.account();
    const owner = await character(store);
    const created = await store.create('module', { name: 'Bell', description: '', namespace: null, regex: [], triggers: [], toggles: [], loreFolders: [] });
    if (!created.ok) throw new Error(created.error);
    const module = { kind: 'module', id: created.data.id } as const;
    await setBackground(store, owner, '<style>.a{}</style>');
    await setBackground(store, module, '<div>bell</div>');
    expect(store.get('character', owner.id)!.value.card.background).toBe('<style>.a{}</style>');
    expect(store.get('module', module.id)!.value.background).toBe('<div>bell</div>');
    await setBackground(store, module, '  \n');
    expect(store.get('module', module.id)!.value).not.toHaveProperty('background');
  });
});
