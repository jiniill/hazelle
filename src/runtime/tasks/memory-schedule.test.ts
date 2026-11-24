import { expect, it } from 'vitest';
import { MemorySchedule } from './memory-schedule';

it('keeps a running plan to the check it began with, and plans a full check that came during it once, after it', () => {
  const schedule = new MemorySchedule();
  schedule.begin('c', 'stale');
  schedule.planning('c');
  schedule.queue('c', 'full');
  expect(schedule.includesNew('c')).toBe(false);
  expect(schedule.finish('c')).toBe('full');
});
