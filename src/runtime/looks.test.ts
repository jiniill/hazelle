import { expect, it } from 'vitest';
import { accountSettings } from './account-settings';
import { addLook, editLook, moveLook, removeLook, restoreLook } from './looks';
import { testServer } from './testing';

const server = testServer();
const ids = (store: Parameters<typeof accountSettings>[0]) => accountSettings(store).looks?.map(({ id }) => id);

it('puts a removed look back where it was, moves one to where the target was either way, and edits only its own', async () => {
  const { store } = await server.account();
  for (const id of ['a', 'b', 'x', 'c']) await addLook(store, { id, name: id, look: { theme: 'dark' } });
  const removed = await removeLook(store, 'b');
  if (!removed.ok) throw new Error(removed.error);
  expect(ids(store)).toEqual(['a', 'x', 'c']);
  await restoreLook(store, removed.data);
  expect(ids(store)).toEqual(['a', 'b', 'x', 'c']);
  expect(await removeLook(store, 'gone')).toEqual({ ok: false, error: 'gone' });

  await moveLook(store, 'a', 'c');
  expect(ids(store)).toEqual(['b', 'x', 'c', 'a']);
  await moveLook(store, 'c', 'b');
  expect(ids(store)).toEqual(['c', 'b', 'x', 'a']);

  await editLook(store, 'x', { name: '밤' });
  expect(accountSettings(store).looks?.map(({ name }) => name)).toEqual(['c', 'b', '밤', 'a']);
});
