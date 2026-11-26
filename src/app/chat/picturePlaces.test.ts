import { expect, it } from 'vitest';
import type { Stored } from '../../model/kinds';
import { pagedPicture, picturePlaces } from './picturePlaces';

it('shows the picture paged to until a newer one lands in its place', () => {
  const [old, newer, newest] = ['a', 'b', 'c'].map((id) => ({ id }) as Stored<'illustration'>);
  expect(pagedPicture([old!, newer!], null)).toBe(newer);
  expect(pagedPicture([old!, newer!], { id: 'a', newest: 'b' })).toBe(old);
  expect(pagedPicture([old!, newer!, newest!], { id: 'a', newest: 'b' })).toBe(newest);
  expect(pagedPicture([newer!], { id: 'a', newest: 'b' })).toBe(newer);
});

it('puts a failed run of the plugin holding 삽화 at the message end with the slot it was for', () => {
  const failure = { kind: 'held', why: 'failed', name: '화실' } as const;
  const drawing = { chat: 'c', version: 'v', writing: false, failure, sketches: [], by: { module: 'm', name: '화실' } };
  expect(picturePlaces({ ...drawing, slot: 'cover' }, [], 'text')).toEqual([{ paragraph: null, kind: 'failed', failure, version: 'v', scene: null, slot: 'cover' }]);
  expect(picturePlaces(drawing, [], 'text')).toEqual([{ paragraph: null, kind: 'failed', failure, version: 'v', scene: null }]);
});
