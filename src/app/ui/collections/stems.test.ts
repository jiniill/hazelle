import { expect, it } from 'vitest';
import { placeStems, type Sprout, type Stem } from './stems';

const metrics = { unit: 2, min: 20, max: 200, head: { width: 100, height: 10 }, gap: 20, drop: 30 };
const stem = (key: string, length: number, children: Sprout[] = []): Stem => ({ key, length, children });
const sprout = (kind: Sprout['kind'], at: number | null, stem: Stem): Sprout => ({ kind, at, label: '', stem });

it('draws a line as long as its units, within the bounds', () => {
  const { stems, height } = placeStems(stem('a', 50), metrics);
  expect(stems.map(({ x, top, from, to }) => [x, top, from, to])).toEqual([[50, 0, 10, 110]]);
  expect(height).toBe(110);
  expect(placeStems(stem('b', 3), metrics).stems[0]!.to).toBe(30);
  expect(placeStems(stem('c', 900), metrics).stems[0]!.to).toBe(210);
});

it('sprouts a branch at its unit of the parent, and a copy or a branch of no known unit from the end', () => {
  const root = stem('a', 100, [sprout('branch', 25, stem('b', 10)), sprout('copy', null, stem('c', 10)), sprout('branch', null, stem('d', 10))]);
  const { sprouts } = placeStems(root, metrics);
  expect(sprouts.map(({ sprout, y, child }) => [sprout.stem.key, y, child.top])).toEqual([
    ['c', 210, 240],
    ['d', 210, 240],
    ['b', 60, 90],
  ]);
  expect(placeStems(stem('a', 10, [sprout('branch', 30, stem('b', 10))]), metrics).sprouts[0]!.y).toBe(30);
});

it('stacks siblings in the lane right of the parent while each is a drop clear of the next, the lowest sprout placed first, and lanes one that would overlap further out', () => {
  const root = stem('a', 100, [sprout('branch', 10, stem('b', 100)), sprout('branch', 50, stem('c', 10)), sprout('copy', null, stem('d', 10))]);
  const { stems, width } = placeStems(root, metrics);
  expect(stems.map(({ stem, lane, top }) => [stem.key, lane, top])).toEqual([
    ['a', 0, 0],
    ['d', 1, 240],
    ['c', 1, 140],
    ['b', 2, 60],
  ]);
  expect(width).toBe(340);
});

it('keeps a grandchild right of its parent, and a sibling past every lane their lines hold', () => {
  const root = stem('a', 100, [sprout('branch', 90, stem('b', 10, [sprout('branch', 5, stem('e', 10))])), sprout('branch', 20, stem('c', 100))]);
  const { stems } = placeStems(root, metrics);
  expect(stems.map(({ stem, lane }) => [stem.key, lane])).toEqual([
    ['a', 0],
    ['b', 1],
    ['e', 2],
    ['c', 3],
  ]);
});
