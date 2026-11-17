import { expect, it } from 'vitest';
import { misses, regionOf } from './layer';

it('keeps the outermost boxes of each kind, one of two alike, and no box that only shows inside one that takes input', () => {
  expect(regionOf([[0, 0, 100, 100], [10, 10, 20, 20], [0, 0, 100, 100], [200, 0, 300, 50]], [[30, 30, 40, 40], [400, 0, 500, 50], [410, 10, 420, 20], [90, 90, 110, 110]])).toEqual({
    takes: [[0, 0, 100, 100], [200, 0, 300, 50]],
    shows: [[400, 0, 500, 50], [90, 90, 110, 110]],
  });
});

it('says a touch that lands on nothing of its own and its end, and a mouse once as it leaves its boxes', () => {
  const said: string[] = [];
  const pointers = misses((what) => said.push(what));
  pointers.pressed(false, true);
  pointers.lifted();
  pointers.pressed(true, false);
  expect(said).toEqual([]);
  pointers.pressed(false, false);
  pointers.lifted();
  pointers.lifted();
  expect(said).toEqual(['down', 'up']);
  pointers.moved(false, false);
  pointers.moved(true, true);
  pointers.moved(true, false);
  pointers.moved(true, false);
  pointers.moved(true, true);
  pointers.moved(true, false);
  expect(said).toEqual(['down', 'up', 'over', 'over']);
  pointers.laid();
  pointers.moved(true, false);
  expect(said.slice(4)).toEqual(['over']);
});
