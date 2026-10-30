import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { VISITORS_PER_ADDRESS } from '../contracts/admin';
import { VISITOR_HEADER } from '../contracts/http';
import { migrate } from './db/migrate';
import { serviceDb } from './db/service-db';
import { DAY_MS, visitDay } from './http';
import { clientFiles } from './static';
import { openVisits, readVisits } from './visits';

const MIDNIGHT = Date.parse('2026-10-21T15:00:00Z');
let now: number;
let raw: DatabaseSync;
let dir: string;
let visits: ReturnType<typeof openVisits>;
let client: ReturnType<typeof clientFiles>;
beforeEach(() => {
  now = MIDNIGHT - 1;
  raw = new DatabaseSync(':memory:');
  migrate(raw, 'migrations');
  visits = openVisits(raw, () => now);
  dir = mkdtempSync(join(tmpdir(), 'hazelle-visits-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>page');
  writeFileSync(join(dir, 'assets/app.js'), 'app');
  client = clientFiles(dir, async () => null, async () => ({ at: now, board: null }), visits.page);
});
afterEach(() => {
  raw.close();
  rmSync(dir, { recursive: true, force: true });
});
const load = (path = '/', agent = 'Browser', address = '192.0.2.1') => client.request(path, { headers: { accept: 'text/html', 'user-agent': agent, [VISITOR_HEADER]: address } });
const today = async () => (await readVisits(serviceDb(raw), now))[0];

it('counts HTML loads once per address and browser per KST day, including across an API restart', async () => {
  await Promise.all([load(), load('/chats/abc'), load('/privacy')]);
  visits = openVisits(raw, () => now);
  visits.page({ kind: 'visit', address: '192.0.2.1', agent: 'Browser' });
  expect(await today()).toMatchObject({ day: visitDay(now), visitors: 1 });
  await load('/', 'Other browser');
  await load('/', 'Browser', '192.0.2.2');
  expect(await today()).toMatchObject({ visitors: 3 });
  now = MIDNIGHT;
  await load();
  const days = await readVisits(serviceDb(raw), now);
  expect(days).toHaveLength(14);
  expect(days.slice(0, 2).map(({ visitors }) => visitors)).toEqual([1, 3]);
  expect(days.map(({ day }) => day)).toEqual(Array.from({ length: 14 }, (_, index) => MIDNIGHT - index * DAY_MS));
});

it('does not count assets, API paths, failed documents, HEAD requests or crawler user agents', async () => {
  for (const path of ['/assets/app.js', '/assets/missing.js', '/api', '/api/session', '/api/unknown']) await load(path);
  await client.request('/', { method: 'HEAD' });
  for (const agent of ['Googlebot', 'Crawler', 'SPIDER', 'Slurp', 'LinkPreview']) await load('/', agent);
  expect(await today()).toMatchObject({ visitors: 0 });
  expect(raw.prepare('SELECT * FROM visit_keys').all()).toEqual([]);
});

it('closes a day without another visit, deleting its key and hashes while preserving its daily total', async () => {
  await load();
  const key = raw.prepare('SELECT key FROM visit_keys').get();
  const hash = raw.prepare('SELECT hash FROM visit_hashes').get();
  expect(raw.prepare('SELECT day FROM visit_hashes').all()).toHaveLength(1);
  now = MIDNIGHT;
  visits.close();
  expect(raw.prepare('SELECT * FROM visit_keys').all()).toEqual([]);
  expect(raw.prepare('SELECT * FROM visit_hashes').all()).toEqual([]);
  expect(raw.prepare('SELECT visitors FROM visit_days').all()).toEqual([{ visitors: 1 }]);
  await load();
  expect(raw.prepare('SELECT key FROM visit_keys').get()).not.toEqual(key);
  expect(raw.prepare('SELECT hash FROM visit_hashes').get()).not.toEqual(hash);
});

it('counts at most VISITORS_PER_ADDRESS browsers of one address a day, and keeps a guest id 7 days for 손님 출신', async () => {
  for (let index = 0; index <= VISITORS_PER_ADDRESS; index++) visits.page({ kind: 'visit', address: '192.0.2.1', agent: `Browser ${index}` });
  visits.page({ kind: 'visit', address: '192.0.2.2', agent: 'Browser 0' });
  expect(await today()).toMatchObject({ visitors: VISITORS_PER_ADDRESS + 1 });
  const guest = raw.prepare("INSERT INTO visit_guests (day, guest, step) VALUES (?, ?, 'replied')");
  guest.run(visitDay(now) - 6 * DAY_MS, 'kept');
  guest.run(visitDay(now) - 7 * DAY_MS, 'gone');
  visits.close();
  expect(raw.prepare('SELECT guest FROM visit_guests').all()).toEqual([{ guest: 'kept' }]);
});
