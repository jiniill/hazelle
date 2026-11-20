import { expect, it } from 'vitest';
import { drawnInk, settled, startInk, stepInk, WIDTH, type Ink } from './ink';

const pace = { follow: 450, even: 200, idle: 250, close: 350 };
const FRAME = 16;

it('starts solid at the length the story has when its writing begins', () => {
  const ink = startInk(120, 0);
  expect(settled(ink)).toBe(true);
  expect(stepInk(ink, FRAME, FRAME, pace)).toMatchObject({ edge: 120, solid: 120 });
});

it('never takes back what it has shown, however the text arrives', () => {
  let ink = startInk(0, 0);
  let length = 0;
  let seed = 3;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let now = FRAME; now < 20_000; now += FRAME) {
    if (random() < 0.05) ink = drawnInk(ink, (length += Math.floor(random() * 160)), now);
    const next: Ink = stepInk(ink, FRAME, now, pace);
    expect(next.edge).toBeGreaterThanOrEqual(ink.edge);
    expect(next.solid).toBeGreaterThanOrEqual(ink.solid);
    expect(next.edge).toBeLessThanOrEqual(length);
    expect(next.solid).toBeLessThanOrEqual(next.edge);
    expect(next.edge - next.solid).toBeLessThanOrEqual(WIDTH);
    ink = next;
  }
});

it('closes on the end once nothing more comes, and waits on its gradient while more does', () => {
  let ink = drawnInk(startInk(0, 0), 200, 0);
  for (let now = FRAME; now <= 200; now += FRAME) ink = stepInk(ink, FRAME, now, pace);
  expect(ink.solid).toBe(Math.max(0, ink.edge - WIDTH));
  for (let now = 200 + FRAME; now < 5000; now += FRAME) ink = stepInk(ink, FRAME, now, pace);
  expect(settled(ink)).toBe(true);
});

it('stays inside a text that got shorter', () => {
  const ink = drawnInk({ ...startInk(0, 0), length: 300, edge: 250, solid: 220 }, 230, 10);
  expect(ink).toMatchObject({ length: 230, edge: 230, solid: 220 });
});
