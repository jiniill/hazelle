import { expect, it } from 'vitest';
import { groupCopies, latestFirst, type Copied } from './copies';

type Thing = { id: string; origin?: string; folder: string | null; at: number | null };
const OF: Copied<Thing> = { id: (item) => item.id, origin: (item) => item.origin, folder: (item) => item.folder };
const thing = (id: string, origin?: string, folder: string | null = null, at: number | null = null): Thing => ({ id, origin, folder, at });
const ids = (things: readonly Thing[]) => things.map(({ id }) => id);

it('nests each copy under its original in the list’s order, recursing, and promotes one whose original is gone', () => {
  const things = [thing('z', 'root'), thing('root'), thing('orphan', 'missing'), thing('a', 'root'), thing('nested', 'orphan'), thing('own'), thing('leaf', 'a')];
  const before = [...things];
  const { top, copies } = groupCopies(things, OF);
  expect(ids(top)).toEqual(['root', 'orphan', 'own']);
  expect(ids(copies.get('root')!)).toEqual(['z', 'a']);
  expect(ids(copies.get('orphan')!)).toEqual(['nested']);
  expect(ids(copies.get('a')!)).toEqual(['leaf']);
  expect(top.length + [...copies.values()].reduce((sum, group) => sum + group.length, 0)).toBe(things.length);
  expect(things).toEqual(before);

  const removed = groupCopies(things.filter(({ id }) => id !== 'root'), OF);
  expect(ids(removed.top)).toEqual(['z', 'orphan', 'a', 'own']);
  expect(ids(removed.copies.get('a')!)).toEqual(['leaf']);
  expect(removed.copies.has('root')).toBe(false);
});

it('keeps a copy filed in another folder than its original in its own folder, not under the original', () => {
  const { top, copies } = groupCopies([thing('root', undefined, 'a'), thing('here', 'root', 'a'), thing('away', 'root', 'b')], OF);
  expect([ids(top), ids(copies.get('root')!)]).toEqual([['root', 'away'], ['here']]);
});

it('places a row by the latest moment among it and its copies, those with none after the rest in their order', () => {
  const things = [thing('b'), thing('a'), thing('old', undefined, null, 10), thing('root'), thing('copy', 'root', null, 20), thing('deep', 'copy', null, 30)];
  const { top, copies } = groupCopies(things, OF);
  expect(ids(top.toSorted(latestFirst(OF, (item) => item.at, copies)))).toEqual(['root', 'old', 'b', 'a']);
});
