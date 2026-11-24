import { afterEach, expect, it, vi } from 'vitest';
import { progressed } from '../engine/progress';
import { postProgress, type Sign } from './worker';

afterEach(() => vi.restoreAllMocks());

it('names the unit about to begin at most every 50 ms, a slow one as it ends, and a job\'s last units when the job ends', () => {
  let now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  const signs: Sign[] = [];
  const job = postProgress((sign) => signs.push(sign));
  const regex = (script: number) => progressed('regex', 3, script, 8000, 'display');
  const unit = (script: number) => ({ kind: 'regex', stage: 'display', message: 3, script, chars: 8000 });
  job.begins();
  regex(0);
  now = 10;
  regex(1);
  now = 20;
  regex(2);
  expect(signs).toEqual([{ unit: unit(0), ended: 0, slow: null }]);
  now = 720;
  regex(3);
  expect(signs[1]).toEqual({ unit: unit(3), ended: 3, slow: { ...unit(2), ms: 700 } });
  now = 730;
  regex(4);
  now = 800;
  job.ends();
  expect(signs[2]).toEqual({ unit: null, ended: 2, slow: { ...unit(4), ms: 70 } });
  // The next job's first unit is told at once, and counts nothing of the one before.
  job.begins();
  now = 810;
  progressed('message', 0, null, 5);
  expect(signs[3]).toEqual({ unit: { kind: 'message', stage: null, message: 0, script: null, chars: 5 }, ended: 0, slow: null });
});
