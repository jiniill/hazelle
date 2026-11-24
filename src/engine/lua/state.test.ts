import { expect, it, vi } from 'vitest';
import { evaluate } from '../cbs/evaluate';
import { SNAPSHOT } from './fixture';
import { cbs, working, write, type Run } from './state';

vi.mock('../cbs/evaluate', async (original) => {
  const real = await original<typeof import('../cbs/evaluate')>();
  return { ...real, evaluate: vi.fn(real.evaluate) };
});

it('reads its variables from one map until the run writes, and then the write', () => {
  const run: Run = { owner: null, chat: 'chat', lore: new Map(), quiet: false, snapshot: SNAPSHOT, variables: new Map(SNAPSHOT.variables), globals: new Map(), written: new Map(), messages: working(SNAPSHOT), host: null, stop: false, reload: false, missing: new Set(), ranAway: false, triggerId: '' };
  expect([cbs(run, '{{getvar::hp}}'), cbs(run, '{{getvar::hp}}')]).toEqual(['10', '10']);
  write(run, 'hp', '3');
  expect(cbs(run, '{{getvar::hp}}')).toBe('3');
  const [first, second, written] = vi.mocked(evaluate).mock.calls.map(([, context]) => context.variables);
  expect(second).toBe(first);
  expect(written).not.toBe(first);
});
