import { expect, it } from 'vitest';
import { placeRows, placeStems, type PlacedPill, type Sprout, type Stem } from './stems';

const metrics = { unit: 2, min: 20, max: 200, head: { width: 100, height: 10 }, gap: 20, drop: 30, pill: 12, endDrop: 8 };
const stem = (key: string, length: number, children: Sprout[] = []): Stem => ({ key, length, children });
const sprout = (kind: Sprout['kind'], at: number | null, stem: Stem): Sprout => ({ kind, at, stem });
const pillShape = ({ pill, y, onPath }: PlacedPill) => [pill.kind, pill.at, y, pill.sprouts.map(({ stem }) => stem.key), onPath];

it('draws a line as long as its units, within the bounds', () => {
  const { stems, height } = placeStems(stem('a', 50), metrics);
  expect(stems.map(({ x, top, from, to }) => [x, top, from, to])).toEqual([[50, 0, 10, 110]]);
  expect(height).toBe(110);
  expect(placeStems(stem('b', 3), metrics).stems[0]!.to).toBe(30);
  expect(placeStems(stem('c', 900), metrics).stems[0]!.to).toBe(210);
});

it('stands a pill at a branch unit of the parent, and under its end for a copy, then a branch of no known unit, a step apart', () => {
  const root = stem('a', 100, [sprout('branch', 25, stem('b', 10)), sprout('copy', null, stem('c', 10)), sprout('branch', null, stem('d', 10))]);
  const { pills, sprouts, height } = placeStems(root, metrics);
  expect(pills.map(pillShape)).toEqual([
    ['branch', 25, 60, ['b'], false],
    ['copy', null, 218, ['c'], false],
    ['unplaced', null, 230, ['d'], false],
  ]);
  expect(sprouts.map(({ sprout, pill, child }) => [sprout.stem.key, pill.y, child.top, child.lane])).toEqual([
    ['d', 230, 260, 1],
    ['c', 218, 248, 2],
    ['b', 60, 90, 1],
  ]);
  expect(height).toBe(290);
  expect(placeStems(stem('a', 10, [sprout('branch', 30, stem('b', 10))]), metrics).pills[0]!.y).toBe(30);
});

it('shares one pill between the sprouts of one unit, and keeps pills of near units a step apart', () => {
  const root = stem('a', 100, [sprout('branch', 25, stem('b', 10)), sprout('branch', 40, stem('d', 10)), sprout('branch', 25, stem('c', 10))]);
  const { pills, sprouts } = placeStems(root, metrics);
  expect(pills.map(pillShape)).toEqual([
    ['branch', 25, 60, ['b', 'c'], false],
    ['branch', 40, 90, ['d'], false],
  ]);
  expect(sprouts.map(({ sprout, pill }) => [sprout.stem.key, pill === pills[0]])).toEqual([['d', false], ['b', true], ['c', true]]);
  const near = stem('a', 100, [sprout('branch', 25, stem('b', 10)), sprout('branch', 26, stem('c', 10)), sprout('branch', 100, stem('d', 10)), sprout('copy', null, stem('e', 10))]);
  expect(placeStems(near, metrics).pills.map(({ y }) => y)).toEqual([60, 72, 210, 222]);
});

it('stacks siblings in the lane right of the parent while each is a drop clear of the next, the lowest pill placed first, and lanes one that would overlap further out', () => {
  const root = stem('a', 100, [sprout('branch', 10, stem('b', 100)), sprout('branch', 50, stem('c', 10)), sprout('copy', null, stem('d', 10))]);
  const { stems, width } = placeStems(root, metrics);
  expect(stems.map(({ stem, lane, top }) => [stem.key, lane, top])).toEqual([
    ['a', 0, 0],
    ['d', 1, 248],
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

it('places the sprout leading to the current stem first, so its lane is nearest, and marks the way to it', () => {
  const root = stem('a', 100, [sprout('branch', 10, { ...stem('b', 100), children: [sprout('branch', 5, { ...stem('e', 10), current: true })] }), sprout('branch', 50, stem('c', 10)), sprout('copy', null, stem('d', 10))]);
  const { stems, pills, sprouts } = placeStems(root, metrics);
  expect(stems.map(({ stem, lane, onPath, via }) => [stem.key, lane, onPath, via?.kind ?? null])).toEqual([
    ['a', 0, true, null],
    ['b', 1, true, 'branch'],
    ['e', 2, true, 'branch'],
    ['d', 2, false, 'copy'],
    ['c', 3, false, 'branch'],
  ]);
  expect(pills.map(({ pill, onPath }) => [pill.at, onPath])).toEqual([[10, true], [50, false], [null, false], [5, true]]);
  expect(sprouts.map(({ sprout, onPath }) => [sprout.stem.key, onPath])).toEqual([['e', true], ['b', true], ['d', false], ['c', false]]);
});

it('lists the family in order, each stem before its sprouts in pill order, a lane per depth, the links leaving the parent lane above the child row', () => {
  const root = stem('a', 100, [sprout('branch', 25, stem('b', 10, [sprout('branch', 5, { ...stem('e', 10), current: true })])), sprout('copy', null, stem('c', 10)), sprout('branch', 10, stem('d', 10))]);
  const { width, height, rows, pills, links } = placeRows(root, { head: 20, gap: 4, lane: 10, end: 30 });
  expect(rows.map(({ stem, lane, index, top, x, y, to, onPath }) => [stem.key, lane, index, top, x, y, to, onPath])).toEqual([
    ['a', 0, 0, 0, 10, 10, 94, true],
    ['d', 1, 1, 24, 20, 34, 34, false],
    ['b', 1, 2, 48, 20, 58, 70, true],
    ['e', 2, 3, 72, 30, 82, 82, true],
    ['c', 1, 4, 96, 20, 106, 106, false],
  ]);
  expect(pills.map(({ pill, x, y, onPath }) => [pill.kind, pill.at, x, y, onPath])).toEqual([
    ['branch', 10, 10, 22, false],
    ['branch', 25, 10, 46, true],
    ['branch', 5, 20, 70, true],
    ['copy', null, 10, 94, false],
  ]);
  expect(links.map(({ parent, child, pill }) => [parent.stem.key, child.stem.key, pill.y])).toEqual([['a', 'd', 22], ['b', 'e', 70], ['a', 'b', 46], ['a', 'c', 94]]);
  expect(width).toBe(60);
  expect(height).toBe(116);
});
