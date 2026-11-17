import { expect, it } from 'vitest';
import { holdAfter, type Heard, type Hold } from './ToolFrame';

const HELD: Hold = { held: true, mouse: false };
const pointer = (on: Exclude<Heard['on'], 'missed'>, mouse: boolean, where: 'takes' | 'shows' | 'neither'): Heard => ({ on, mouse, takes: where === 'takes', shows: where === 'shows' });
const missed = (what: 'down' | 'up' | 'over'): Heard => ({ on: 'missed', what });

it('lets a laid frame go for a touch on nothing of its own until that touch has ended and its click has been aimed', () => {
  const let_go = holdAfter(HELD, missed('down'));
  expect(let_go).toEqual({ hold: { held: false, mouse: false }, after: null });
  expect(holdAfter(let_go.hold, missed('up'))).toEqual({ hold: let_go.hold, after: 350 });
  expect(holdAfter(let_go.hold, pointer('up', false, 'neither'))).toEqual({ hold: let_go.hold, after: 350 });
  expect(holdAfter(let_go.hold, pointer('click', false, 'shows'))).toEqual({ hold: let_go.hold, after: 0 });
  // Another touch before then withdraws the wait, and one on a box that takes input gives the frame back at once.
  expect(holdAfter(let_go.hold, pointer('down', false, 'shows'))).toEqual({ hold: let_go.hold, after: null });
  expect(holdAfter(let_go.hold, pointer('down', false, 'takes'))).toEqual({ hold: HELD, after: null });
  // While it takes input nothing of the screen's own changes that.
  for (const heard of [missed('up'), pointer('up', false, 'neither'), pointer('click', true, 'neither'), pointer('move', true, 'neither')]) expect(holdAfter(HELD, heard)).toEqual({ hold: HELD });
});

it('lets a laid frame go for a mouse over a box that only shows, until the mouse is over no such box', () => {
  const let_go = holdAfter(HELD, missed('over'));
  expect(let_go).toEqual({ hold: { held: false, mouse: true }, after: null });
  expect(holdAfter(let_go.hold, pointer('move', true, 'shows'))).toEqual({ hold: let_go.hold });
  // Not by time: its press and click there are the app's.
  expect(holdAfter(let_go.hold, pointer('down', true, 'shows'))).toEqual({ hold: let_go.hold });
  expect(holdAfter(let_go.hold, pointer('click', true, 'shows'))).toEqual({ hold: let_go.hold });
  expect(holdAfter(let_go.hold, missed('up'))).toEqual({ hold: let_go.hold });
  expect(holdAfter(let_go.hold, pointer('move', true, 'takes'))).toEqual({ hold: HELD, after: null });
  expect(holdAfter(let_go.hold, pointer('move', true, 'neither'))).toEqual({ hold: HELD, after: null });
});
