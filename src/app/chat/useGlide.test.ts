import { expect, test } from 'vitest';
import { glideOn, type Glide } from './useGlide';

// A browser that keeps whole pixels: what is read back is what was put, rounded.
const frames = (count: number, speed: number, glide: Glide = { at: 0, until: 0 }, end = 1000) => {
  for (let i = 1; i <= count; i++) glide = glideOn(glide, Math.round(glide.at), end, i * 16, 16, speed);
  return glide;
};

test('a pace under a pixel a frame still adds up, and stops at the end', () => {
  expect(frames(125, 8).at).toBeCloseTo(16);
  expect(frames(125, 8, { at: 995.5, until: 0 }).at).toBe(1000);
});

test('it waits while the reader has the view, then goes on from where it was', () => {
  expect(frames(10, 60, { at: 100, until: Infinity }).at).toBe(100);
  expect(frames(10, 60, { at: 100, until: 80 }).at).toBeCloseTo(100 + 60 * 0.096);
});

test('a move from elsewhere is taken as where the view is, and it goes on from there once that settles', () => {
  const moved = glideOn({ at: 100, until: 0 }, 400, 1000, 16, 16, 60);
  expect(moved.at).toBe(400);
  expect(glideOn(moved, 400, 1000, 32, 16, 60).at).toBe(400);
  expect(glideOn(moved, 400, 1000, moved.until, 16, 60).at).toBeGreaterThan(400);
  expect(glideOn({ at: 100, until: Infinity }, 400, 1000, 16, 16, 60)).toEqual({ at: 400, until: Infinity });
});
