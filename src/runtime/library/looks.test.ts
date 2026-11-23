import { expect, it } from 'vitest';
import { accountSettings } from '../account-settings';
import { STARTER_PRESETS } from '../../model/settings';
import { addStarters, savedLooks } from './looks';
import { testServer } from '../testing';

const server = testServer();
const STARTERS = STARTER_PRESETS.map(({ id }) => id);
const ids = (store: Parameters<typeof accountSettings>[0]) => accountSettings(store).presets?.map(({ id }) => id).filter((id) => !STARTERS.includes(id));

it('puts a removed look back where it was, moves one to where the target was either way, and edits only its own', async () => {
  const { store } = await server.account();
  const looks = savedLooks(store);
  for (const id of ['a', 'b', 'x', 'c']) await looks.add({ id, name: id, look: { mode: 'dark' } });
  const removed = await looks.remove('b');
  if (!removed.ok) throw new Error(removed.error);
  expect(ids(store)).toEqual(['a', 'x', 'c']);
  await looks.restore(removed.data);
  expect(ids(store)).toEqual(['a', 'b', 'x', 'c']);
  expect(await looks.remove('gone')).toEqual({ ok: false, error: 'gone' });

  await looks.move('a', 'c');
  expect(ids(store)).toEqual(['b', 'x', 'c', 'a']);
  await looks.move('c', 'b');
  expect(ids(store)).toEqual(['c', 'b', 'x', 'a']);

  await looks.edit('x', { name: '밤' });
  expect(accountSettings(store).presets?.slice(STARTERS.length).map(({ name }) => name)).toEqual(['c', 'b', '밤', 'a']);
});

it('starts from the starter presets, which are removed like any other and put back at the end, the rest kept', async () => {
  const { store } = await server.account();
  await savedLooks(store).add({ id: 'mine', name: '내 것', look: { mode: 'dark' } });
  expect(accountSettings(store).presets?.map(({ id }) => id)).toEqual([...STARTERS, 'mine']);
  for (const id of ['default', 'sea']) await savedLooks(store).remove(id);
  await addStarters(store);
  expect(accountSettings(store).presets?.map(({ id }) => id)).toEqual([...STARTERS.filter((id) => id !== 'default' && id !== 'sea'), 'mine', 'default', 'sea']);
});
