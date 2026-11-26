import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { readWorkHeader, workHeader } from '../contracts/work';
import { migrate } from './db/migrate';
import { openWork } from './work';

const MINUTE = 60_000;

it('says the announced work until its end, and none once a start comes after its start', () => {
  const db = new DatabaseSync(':memory:');
  migrate(db, 'migrations');
  let now = 1000;
  const said = openWork(db, () => now);
  expect(said()).toBe(workHeader(null));
  db.prepare('UPDATE service SET work_at = ?, work_minutes = 20').run(5000);
  expect(readWorkHeader(said())).toEqual({ at: 5000, minutes: 20 });
  now = 5000 + 20 * MINUTE - 1;
  expect(readWorkHeader(said())).toEqual({ at: 5000, minutes: 20 });
  now += 1;
  expect(readWorkHeader(said())).toBeNull();

  now = 4999;
  expect(readWorkHeader(openWork(db, () => now)())).toEqual({ at: 5000, minutes: 20 });
  now = 5000;
  expect(readWorkHeader(openWork(db, () => now)())).toBeNull();
  expect(db.prepare('SELECT work_at, work_minutes FROM service').get()).toEqual({ work_at: null, work_minutes: null });
  db.close();
});
