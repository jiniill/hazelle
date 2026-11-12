import { expect, it } from 'vitest';
import { minuteOf, presenceReport } from '../model/presence';
import { savePresence } from './presence';
import { presenceMemory, testServer } from './testing';

const server = testServer();
const nine = minuteOf(new Date(2026, 10, 13, 9).getTime());
const minutes = (store: Awaited<ReturnType<typeof server.account>>['store']) => presenceReport(store.list('presence').map(({ value }) => value), 0).minutes;

it('has the tabs of one device write one object a month, a minute either kept landing once, and asks nothing on leaving', async () => {
  const { store, open } = await server.account();
  const device = presenceMemory();
  expect(await savePresence(store, device, [nine])).toBe(true);
  const other = await open();
  await other.pull();
  const saving = Promise.all([savePresence(store, device, [nine, nine + 1]), savePresence(other, device, [nine + 1, nine + 2])]);
  expect(store.unsentWrites()).toBe(0);
  expect(await saving).toEqual([true, true]);
  await store.pull();
  expect(store.list('presence')).toHaveLength(1);
  expect(minutes(store)).toBe(3);
});

it('keeps each device in an object of its own and counts a minute both kept once', async () => {
  const { store, open } = await server.account();
  const other = await open();
  expect(await savePresence(store, presenceMemory(), [nine, nine + 1])).toBe(true);
  expect(await savePresence(other, presenceMemory(), [nine + 1, nine + 2])).toBe(true);
  await store.pull();
  expect(store.list('presence')).toHaveLength(2);
  expect(minutes(store)).toBe(3);
});
