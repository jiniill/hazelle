import { expect, it } from 'vitest';
import { blankCard } from '../../engine/import/card';
import type { Toggle } from '../../model/prompt';
import { accountSettings } from '../account-settings';
import { setToggleValues } from '../library/characters';
import { removePrompt } from '../library/prompts';
import { setChatModel } from '../models/assignment';
import type { Session } from '../session';
import { setFeatureAt } from '../tasks/features';
import { answerable, testServer } from '../testing';
import { chatPresets, chatSetup, holds, partsOf, pickChatPreset, presetNames, togglesApart, type SetChat } from './presets';

const server = testServer();
const check = (key: string): Toggle => ({ key, label: key, kind: 'check', default: '0' });

async function begun({ store }: Session, character: boolean) {
  const prompt = async (name: string, toggles: Toggle[]) => {
    const made = await store.create('prompt', { name, blocks: [], toggles, authorNote: '', models: {} });
    if (!made.ok) throw new Error(made.error);
    return made.data.id;
  };
  const [connection] = store.list('connection');
  await store.update('connection', connection!.id, (current) => ({ ...current, starred: [...current.starred, { ...current.starred[0]!, id: 'n', name: 'N' }] }));
  const owner = character ? await store.create('character', { card: blankCard('루나'), folder: null, loreFolders: [] }) : null;
  if (owner && !owner.ok) throw new Error(owner.error);
  const made = await store.create('chat', { title: null, character: owner?.data.id ?? null, models: {} });
  if (!made.ok) throw new Error(made.error);
  const id = made.data.id;
  const chat = () => store.get('chat', id)!.value;
  const setChat: SetChat = (change) => store.update('chat', id, change);
  const setup = () => {
    const read = chatSetup(store, chat());
    if ('lacks' in read) throw new Error(read.lacks);
    return read;
  };
  return { id, chat, setChat, setup, ref: (model: string) => ({ connection: connection!.id, model }), korean: await prompt('한글', [check('sims'), check('nsfw')]), english: await prompt('영어', [check('sims')]) };
}

it('saves what a chat resolves to, and a pick puts all four back where each lives, which its undo takes back', () =>
  server.withSession(async (session) => {
    const { store } = session;
    await answerable(session);
    const { id, chat, setChat, setup, ref, korean, english } = await begun(session, true);
    const toggles = () => store.get('character', chat().character!)!.value.toggles;

    await store.update('chat', id, (current) => ({ ...current, prompt: korean }));
    await setToggleValues(store, chat().character, { sims: '1' });
    const saved = { id: 'a', name: '제미니 한글', ...partsOf(setup()) };
    expect(saved).toMatchObject({ model: ref('m'), prompt: korean, toggles: { sims: '1', nsfw: '0' }, translate: true });
    await chatPresets(store).add(saved);
    expect(accountSettings(store).chatPresets).toEqual([saved]);
    expect(holds(setup(), saved)).toBe(true);

    await setChatModel(store, id, ref('n'));
    await store.update('chat', id, (current) => ({ ...current, prompt: english }));
    await setToggleValues(store, chat().character, { sims: '0' });
    await setFeatureAt(store, { kind: 'chat', id }, 'translate', false);
    expect(holds(setup(), saved)).toBe(false);

    const picked = await pickChatPreset(store, chat(), saved, setChat);
    if (!picked.ok) throw new Error(picked.error);
    expect(chat()).toMatchObject({ models: { main: ref('m') }, prompt: korean, features: { translate: true } });
    expect(toggles()).toEqual({ sims: '1', nsfw: '0' });
    expect(holds(setup(), saved)).toBe(true);

    await picked.data();
    expect(chat()).toMatchObject({ models: { main: ref('n') }, prompt: english, features: { translate: false } });
    expect(toggles()).toMatchObject({ sims: '0' });
  }));

it('is not current once its prompt gains a toggle, refuses a pick while its model or prompt is gone, and sends the prompt of a 캐릭터 없이 chat', () =>
  server.withSession(async (session) => {
    const { store } = session;
    await answerable(session);
    const { chat, setChat, setup, ref, korean } = await begun(session, false);
    expect(chatSetup(store, chat())).toEqual({ lacks: 'prompt' });

    const preset = { model: ref('n'), prompt: korean, toggles: { sims: '1' }, translate: false };
    const picked = await pickChatPreset(store, chat(), preset, setChat);
    if (!picked.ok) throw new Error(picked.error);
    expect(chat()).toMatchObject({ sendsPrompt: true, prompt: korean });
    expect(accountSettings(store).toggles).toEqual({ sims: '1' });
    expect(holds(setup(), preset)).toBe(false);
    expect(togglesApart(setup(), preset)).toBe(1);
    expect(togglesApart(setup(), { ...preset, prompt: 'another' })).toBe(0);
    await picked.data();
    expect(chat()).toEqual({ title: null, character: null, models: {} });

    expect(presetNames(store, preset)).toEqual({ model: 'N', prompt: '한글' });
    await store.update('connection', ref('n').connection, (current) => ({ ...current, starred: current.starred.filter(({ id }) => id !== 'n') }));
    expect(presetNames(store, preset)).toEqual({ lacks: 'model' });
    expect(await pickChatPreset(store, chat(), preset, setChat)).toEqual({ ok: false, error: 'gone' });
    await removePrompt(store, korean);
    expect(presetNames(store, { ...preset, model: ref('m') })).toEqual({ lacks: 'prompt' });
  }));
