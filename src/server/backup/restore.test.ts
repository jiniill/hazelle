import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { RestorePhase } from '../../contracts/admin';
import { serviceReads } from '../account-store';
import { accountRegistry, materializeSnapshot, RETENTION_MS } from '../db/account-db';
import { openDatabase, serviceDb, type Db, type Statement } from '../db/service-db';
import { diskBucket } from '../files/disk-bucket';
import { fakeS3 } from '../files/fake-s3';
import { r2Bucket } from '../files/r2-bucket';
import { DAY_MS, sha256Hex, type Services } from '../http';
import { beginRestore, cancelRestore, runRestore } from '../lifecycle';
import { relayBudget, tokenBucket, uploadBudget, visitorLimits } from '../limits';
import { openPulse } from '../pulse';
import { streamRegistry } from '../stream-registry';
import { streamStore } from '../db/streams-db';
import { proof, sessionCookie, testApp } from '../testing';
import app from '../worker';
import { alerts } from '../alerts';
import { backups } from './backups';
import { DEPARTURES } from './departures';
import { captureGeneration, generationsDir, listGenerations, MANIFEST, POOL, readManifest } from './generation';
import { restoreGeneration } from './restore';
import { dayStart } from './snapshots';

const HOUR_MS = 60 * 60 * 1000;
const X = '11111111-1111-4111-8111-111111111111';

let t: Awaited<ReturnType<typeof testApp>>;
const scratch: string[] = [];
beforeAll(async () => {
  t = await testApp();
});
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 100').run();
});
afterAll(() => {
  t.dispose();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const emptyDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-restore-'));
  scratch.push(dir);
  return dir;
};

class Stop extends Error {}

// env whose run throws right after the operation's phase moved to `phase`, leaving the rows there.
function stoppingAt(phase: RestorePhase): Services {
  const db: Db = {
    ...t.env.db,
    batch: async (statements) => {
      const result = await t.env.db.batch(statements);
      if (await t.env.db.prepare('SELECT id FROM restores WHERE phase = ?').bind(phase).first()) throw new Stop();
      return result as never;
    },
    prepare: (sql) => {
      const real = t.env.db.prepare(sql);
      if (!sql.startsWith('UPDATE restores SET phase = ?')) return real;
      return {
        ...real,
        bind: (...values: Parameters<Statement['bind']>) => {
          const bound = real.bind(...values);
          return values[0] === phase ? ({ ...bound, run: async () => (await bound.run(), Promise.reject(new Stop())) } as Statement) : bound;
        },
      } as Statement;
    },
  };
  return { ...t.env, db };
}

// An account holding X 'old' in a baseline from an hour ago, X 'mid' in a newer baseline, then X 'new', and a restore
// to the first baseline left at `phase`: 'old' only comes back by installing the target, 'new' only from the checkpoint.
async function leftAt(username: string, phase: RestorePhase) {
  const now = Date.now();
  t.clock.now = () => now - HOUR_MS;
  const user = await t.signUp(username);
  const write = (body: string, baseRev: number | null) => t.stores.getByName(user.incarnation).batch(user.incarnation, user.timeline, [{ id: X, kind: 'chat', parent: null, body, baseRev }], null);
  await write('old', null);
  await t.stores.snapshot(user.incarnation);
  t.clock.now = () => now - (5 * HOUR_MS) / 6;
  await write('mid', 1);
  await t.stores.snapshot(user.incarnation);
  t.clock.now = () => now - HOUR_MS / 2;
  await write('new', 2);
  t.clock.now = () => Date.now();
  const post = await t.askOperator(user.id);
  const begun = await beginRestore(t.env, user.id, post, { at: now - (11 * HOUR_MS) / 12 });
  const operation = (begun as { begun: number }).begun;
  if (phase !== 'begun') await expect(runRestore(stoppingAt(phase), operation)).rejects.toThrow(Stop);
  return { ...user, post, operation };
}

const bytesOf = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

it.each(['disk', 'r2'] as const)('preserves a %s generation’s released pictures when its baseline still names them, and reclaims them on disaster restore', async (kind) => {
  const disk = t.env.files;
  const s3 = kind === 'r2' ? await fakeS3() : null;
  if (s3) t.env.files = r2Bucket(s3.config);
  t.restartProcess();
  try {
    const now = Date.now();
    const user = await t.signUp('released');
    const bytes = bytesOf('released picture');
    const id = sha256Hex(bytes);
    const key = `files/${user.incarnation}/${id}`;
    expect((await t.put(`files/${id}`, bytes, user.cookie)).status).toBe(204);
    t.clock.now = () => now - HOUR_MS;
    const content = JSON.stringify({ file: { id, key: 'sealed-key' } });
    const write = (body: string | null, baseRev: number | null) => t.stores.getByName(user.incarnation).batch(user.incarnation, user.timeline, [{ id: X, kind: 'asset', parent: null, body, baseRev }], null);
    await write(content, null);
    await t.stores.snapshot(user.incarnation);
    await write(null, 1);
    t.clock.now = () => Date.now();
    await t.env.db.prepare('UPDATE account_files SET claimed_at = 0').run();
    const inventory = await (await t.get('files', user.cookie)).json() as { timeline: string; rev: number };
    expect(await (await t.post('files/sweep', { ...inventory, unused: [id], named: [] }, user.cookie)).json()).toEqual({ released: 1, taken: 0 });

    const capturedAt = now + 2 * DAY_MS;
    const captured = await captureGeneration(t.env, t.dir, capturedAt, () => capturedAt, async (work) => ({ value: await work(), gateMs: 0 }));
    expect(captured.manifest.pictures).toEqual([id]);
    expect(captured.manifest.accounts[0]!.pictureBytes).toBe(bytes.length);
    expect(await t.env.db.prepare('SELECT due_at FROM file_removals').first('due_at')).toBe(capturedAt + RETENTION_MS);
    const generation = join(generationsDir(t.dir), captured.id);
    const destination = emptyDir();
    const files = s3 ? t.env.files : diskBucket(destination);
    if (s3) {
      s3.objects.delete(key);
      await expect(restoreGeneration(generation, destination, 'migrations', files, { fromStore: true })).rejects.toThrow(/missing/);
      expect(readdirSync(destination)).toEqual([]);
      await files.put(key, bytes);
    }
    expect(await restoreGeneration(generation, destination, 'migrations', files, { fromStore: Boolean(s3) })).toMatchObject({ accounts: [{ id: user.id }], pictures: 1 });
    const raw = openDatabase(join(destination, 'service.sqlite'));
    const objects = new DatabaseSync(join(destination, 'accounts', `${user.incarnation}.sqlite`), { readOnly: true });
    try {
      expect(objects.prepare('SELECT body FROM objects WHERE deleted_at IS NULL').all()).toEqual([{ body: content }]);
      expect(raw.prepare('SELECT id, stored FROM account_files').all()).toEqual([{ id, stored: 1 }]);
      expect(raw.prepare('SELECT id FROM file_removals').all()).toEqual([]);
      expect(raw.prepare('SELECT file_bytes FROM accounts').get()).toEqual({ file_bytes: bytes.length });
      expect(new Uint8Array(await new Response((await files.get(key))!).arrayBuffer())).toEqual(bytes);
    } finally {
      objects.close();
      raw.close();
    }
    if (s3) {
      await t.env.db.prepare('DELETE FROM snapshots').run();
      await t.reconcile(now + RETENTION_MS + 1);
      expect(s3.objects.has(key)).toBe(true);
    }
  } finally {
    t.env.files = disk;
    t.restartProcess();
    await s3?.close();
  }
});

it.each(['begun', 'fenced', 'checkpointed', 'done', 'cancelled', 'failed'] as const)('finishes a generation’s unverified %s operation through the live lifecycle', async (phase) => {
  const user = await leftAt(`at-${phase}`, phase === 'cancelled' ? 'targeted' : phase === 'failed' ? 'checkpointed' : phase);
  if (phase === 'cancelled') await expect(cancelRestore(stoppingAt(phase), user.operation)).rejects.toThrow(Stop);
  if (phase === 'failed') {
    await t.env.db.prepare('UPDATE restores SET at = 1 WHERE id = ?').bind(user.operation).run();
    await expect(runRestore(stoppingAt(phase), user.operation)).rejects.toThrow(Stop);
  }
  expect(await t.env.db.prepare('SELECT phase, verified FROM restores WHERE id = ?').bind(user.operation).first()).toEqual({ phase, verified: 0 });
  expect((await t.env.backups.fresh(t.env)).generation).toEqual({ outcome: 'ok', error: null });
  const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
  const destination = emptyDir();
  const ended = ['begun', 'fenced', 'checkpointed'].includes(phase) ? 'cancelled' : phase;
  expect(await restoreGeneration(generation, destination, 'migrations', diskBucket(destination))).toMatchObject({ operations: [{ id: user.operation, phase: ended }], deleted: 0 });
  const raw = openDatabase(join(destination, 'service.sqlite'));
  const db = serviceDb(raw);
  const stores = accountRegistry(destination, db, serviceReads(db), Date.now, diskBucket(destination));
  try {
    expect(await db.prepare('SELECT phase, verified, error FROM restores WHERE id = ?').bind(user.operation).first()).toEqual({ phase: ended, verified: 1, error: phase === 'failed' ? 'too-early' : null });
    expect(await stores.getByName(user.incarnation).status(user.incarnation)).toMatchObject({ state: 'active', operation: null });
    expect(stores.inspect(user.incarnation).exec('SELECT body FROM objects')).toEqual([{ body: phase === 'done' ? 'old' : 'new' }]);
    expect(stores.inspect(user.incarnation).exec('SELECT value FROM kv WHERE key = ?', `restore:${user.operation}`)).toEqual([]);
    expect(await db.prepare('SELECT timeline FROM accounts WHERE id = ?').bind(user.id).first('timeline')).not.toBe(user.timeline);
  } finally {
    stores.close();
    raw.close();
  }
}, 30_000);

it('restores a generation into an empty directory: logins, counts, pictures and blocks, every operation ended by its phase, old timelines refused', async () => {
  const operator = await t.signUp('operator');
  const kept = bytesOf('a kept picture');
  const blocked = bytesOf('a blocked picture');
  for (const bytes of [kept, blocked]) expect((await t.put(`files/${sha256Hex(bytes)}`, bytes, operator.cookie)).status).toBe(204);
  expect((await t.put(`admin/files/${sha256Hex(blocked)}/blocked`, { blocked: true }, operator.cookie)).status).toBe(204);
  const targeted = await leftAt('targeted', 'targeted');
  const armed = await leftAt('armed', 'armed');
  const rewound = await leftAt('rewound', 'rewound');
  const leaver = await t.signUp('leaver');
  expect((await t.put(`files/${sha256Hex(bytesOf('leaving'))}`, bytesOf('leaving'), leaver.cookie)).status).toBe(204);
  await t.lifecycle(leaver.id, "state = 'leaving'");

  expect((await t.daily(Date.now())).generation).toEqual({ outcome: 'ok', error: null });
  const { id } = (await listGenerations(t.dir))[0]!;
  const generation = join(generationsDir(t.dir), id);
  expect((await readManifest(generation))!.operations.map(({ phase }) => phase)).toEqual(['targeted', 'armed', 'rewound']);

  const dir = emptyDir();
  expect(await restoreGeneration(generation, dir, 'migrations', diskBucket(dir))).toEqual({
    accounts: [armed, operator, rewound, targeted].map(({ id }, index) => ({ id, username: ['armed', 'operator', 'rewound', 'targeted'][index] })),
    pictures: 2,
    deleted: 1,
    departures: 'replayed',
    sessions: 4,
    operations: [
      { id: targeted.operation, phase: 'cancelled' },
      { id: armed.operation, phase: 'done' },
      { id: rewound.operation, phase: 'done' },
    ],
  });

  const raw = openDatabase(join(dir, 'service.sqlite'));
  const db = serviceDb(raw);
  const outbound = () => Promise.reject(new Error('no provider'));
  const relay = relayBudget();
  const env: Services = {
    db,
    files: diskBucket(dir),
    stores: accountRegistry(dir, db, serviceReads(db), Date.now, diskBucket(dir)),
    streams: streamRegistry(streamStore(':memory:'), outbound, relay),
    outbound,
    localProviders: new Set(),
    limits: { relay, calls: tokenBucket(240), botCalls: tokenBucket(20), visitors: visitorLimits(), uploads: uploadBudget() },
    backups: backups(dir, 3, alerts(null)),

    pulse: openPulse(db),
  };
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };
  try {
    const send = async (method: string, path: string, body?: unknown, cookie?: string) => {
      const account = cookie && (await db.prepare('SELECT account_id FROM sessions WHERE token_hash = ?').bind(await sha256Hex(cookie.split('=')[1]!)).first<string>('account_id'));
      return app.request(
        `/api/${path}`,
        { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie, ...(account ? { 'x-account': account } : {}) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
        env,
        ctx as never,
      );
    };
    const login = async (username: string, method: 'password' | 'recovery') => {
      const answer = await send('POST', 'login', { username, method, proof: proof(method) });
      expect(answer.status).toBe(200);
      return sessionCookie(answer);
    };
    const contents = async (cookie: string) => ((await (await send('GET', 'objects?since=0', undefined, cookie)).json()) as { changes: { body: string }[] }).changes.map(({ body }) => body);

    const operatorCookie = await login('operator', 'password');
    expect(new Uint8Array(await (await send('GET', `files/${sha256Hex(kept)}`, undefined, operatorCookie)).arrayBuffer())).toEqual(kept);
    expect((await send('GET', `files/${sha256Hex(blocked)}`, undefined, operatorCookie)).status).toBe(403);
    expect((await send('GET', `objects?since=0&timeline=${operator.timeline}`, undefined, operatorCookie)).status).toBe(409);
    expect((await send('POST', 'login', { username: 'leaver', method: 'password', proof: proof('password') })).status).toBe(401);
    expect(existsSync(join(dir, 'files', leaver.incarnation))).toBe(false);
    expect(readdirSync(join(dir, 'files'))).toEqual([operator.incarnation]);

    expect(await contents(await login('targeted', 'recovery'))).toEqual(['new']);
    expect(await contents(await login('rewound', 'password'))).toEqual(['old']);
    const armedCookie = await login('armed', 'password');
    expect(await contents(armedCookie)).toEqual(['old']);
    // The undo of an operation finished by the restore gives back the state it replaced.
    const undo = await beginRestore(env, armed.id, armed.post, { undoes: armed.operation });
    expect(await runRestore(env, (undo as { begun: number }).begun)).toMatchObject({ phase: 'done', verified: true });
    expect(await contents(armedCookie)).toEqual(['new']);
  } finally {
    env.stores.close();
    raw.close();
  }

  // Refused before anything is written: a directory that is not empty, a corrupt artifact, a generation with no manifest.
  await expect(restoreGeneration(generation, dir, 'migrations', diskBucket(dir))).rejects.toThrow(/not empty/);
  const manifest = (await readManifest(generation))!;
  writeFileSync(join(generation, manifest.snapshots[0]!.path), 'torn');
  const clean = emptyDir();
  await expect(restoreGeneration(generation, clean, 'migrations', diskBucket(clean))).rejects.toThrow(/corrupt/);
  expect(readdirSync(clean)).toEqual([]);
  rmSync(join(generation, MANIFEST));
  await expect(restoreGeneration(generation, clean, 'migrations', diskBucket(clean))).rejects.toThrow(/no manifest/);
}, 60_000);

it('deletes again an account that left after the generation, revokes every session and lists the accounts it restored, and refuses without the departures unless told to', async () => {
  const operator = await t.signUp('operator');
  const victim = await t.signUp('victim');
  expect((await t.daily(Date.now())).generation).toEqual({ outcome: 'ok', error: null });
  const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
  expect((await t.delete('account', { method: 'password', proof: proof('password') }, victim.cookie)).status).toBe(204);
  expect(JSON.parse(readFileSync(join(generationsDir(t.dir), DEPARTURES), 'utf8'))).toEqual([{ account: victim.id, incarnation: victim.incarnation, leftAt: expect.any(Number) }]);

  const dir = emptyDir();
  expect(await restoreGeneration(generation, dir, 'migrations', diskBucket(dir))).toMatchObject({
    accounts: [{ id: operator.id, username: 'operator' }],
    deleted: 1,
    departures: 'replayed',
    sessions: 1,
  });
  const raw = openDatabase(join(dir, 'service.sqlite'));
  try {
    expect(raw.prepare('SELECT id FROM accounts').all()).toEqual([{ id: operator.id }]);
    expect(raw.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) AS n FROM admin_log').get()).toEqual({ n: 0 });
  } finally {
    raw.close();
  }
  expect(existsSync(join(dir, 'accounts', `${victim.incarnation}.sqlite`))).toBe(false);
  expect(readFileSync(join(generationsDir(dir), DEPARTURES), 'utf8')).toBe(readFileSync(join(generationsDir(t.dir), DEPARTURES), 'utf8'));

  rmSync(join(generationsDir(t.dir), DEPARTURES));
  const refused = emptyDir();
  await expect(restoreGeneration(generation, refused, 'migrations', diskBucket(refused))).rejects.toThrow(/departures\.json is missing/);
  expect(readdirSync(refused)).toEqual([]);
  const without = emptyDir();
  expect(await restoreGeneration(generation, without, 'migrations', diskBucket(without), { withoutDepartures: true })).toMatchObject({
    accounts: [{ username: 'operator' }, { id: victim.id, username: 'victim' }],
    deleted: 0,
    departures: 'missing',
  });
}, 30_000);

it('restores a version 3 delta baseline as its base with the delta applied', async () => {
  const user = await t.signUp('delta');
  const write = (id: string, body: string, baseRev: number | null) => t.stores.getByName(user.incarnation).batch(user.incarnation, user.timeline, [{ id, kind: 'chat', parent: null, body, baseRev }], null);
  const now = Date.now();
  await write(X, 'in the base', null);
  t.clock.now = () => now - 2 * HOUR_MS;
  await t.stores.snapshot(user.incarnation);
  await write(crypto.randomUUID(), 'in the delta', null);
  t.clock.now = () => now - HOUR_MS;
  const { taken } = (await t.stores.snapshot(user.incarnation)) as { taken: string };
  t.clock.now = () => Date.now();
  expect(await t.env.db.prepare('SELECT base FROM snapshots WHERE id = ?').bind(taken).first('base')).not.toBeNull();
  const rows = 'SELECT id, rev, body FROM objects ORDER BY id';
  const live = { objects: t.stores.inspect(user.incarnation).exec(rows), head: t.stores.inspect(user.incarnation).exec('SELECT rev FROM head') };
  expect(live.objects).toHaveLength(2);

  expect((await t.daily(now)).generation).toEqual({ outcome: 'ok', error: null });
  const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
  expect((await readManifest(generation))!.accounts.find(({ incarnation }) => incarnation === user.incarnation)!.baseline).toBe(taken);
  const legacy = JSON.parse(readFileSync(join(generation, MANIFEST), 'utf8'));
  legacy.version = 3;
  delete legacy.snapshotStore;
  writeFileSync(join(generation, MANIFEST), JSON.stringify(legacy));
  const dir = emptyDir();
  await restoreGeneration(generation, dir, 'migrations', diskBucket(dir));
  const raw = openDatabase(join(dir, 'service.sqlite'));
  const db = serviceDb(raw);
  const stores = accountRegistry(dir, db, serviceReads(db), Date.now, diskBucket(dir));
  try {
    expect({ objects: stores.inspect(user.incarnation).exec(rows), head: stores.inspect(user.incarnation).exec('SELECT rev FROM head') }).toEqual(live);
  } finally {
    stores.close();
    raw.close();
  }
}, 30_000);

it('takes the first snapshot after a disaster restore whole, though the catalog keeps a whole checkpoint newer than the baseline it restored', async () => {
  const user = await t.signUp('lineage');
  const write = (body: string) => t.stores.getByName(user.incarnation).batch(user.incarnation, user.timeline, [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body, baseRev: null }], null);
  const snapshotAt = async (at: number) => {
    t.clock.now = () => at;
    return ((await t.stores.snapshot(user.incarnation)) as { taken: string }).taken;
  };
  const day = dayStart(Date.now()) - DAY_MS;
  await write('in the base');
  const base = await snapshotAt(day + 3 * HOUR_MS - (RETENTION_MS - DAY_MS));
  await write('in the baseline');
  const baseline = await snapshotAt(day + HOUR_MS);
  await write('only in the checkpoint');
  t.clock.now = () => day + 4 * HOUR_MS;
  const post = await t.askOperator(user.id);
  const operation = ((await beginRestore(t.env, user.id, post, { at: day + 2 * HOUR_MS })) as { begun: number }).begun;
  await expect(runRestore(stoppingAt('targeted'), operation)).rejects.toThrow(Stop);
  expect(await cancelRestore(t.env, operation)).toMatchObject({ phase: 'cancelled' });
  const checkpoint = (await t.env.db.prepare('SELECT checkpoint FROM restores WHERE id = ?').bind(operation).first<string>('checkpoint'))!;
  const bases = 'SELECT id, base FROM snapshots ORDER BY taken_at';
  expect((await t.env.db.prepare(bases).all()).results).toEqual([{ id: base, base: null }, { id: baseline, base }, { id: checkpoint, base: null }]);

  expect((await t.daily(day + 5 * HOUR_MS)).generation).toEqual({ outcome: 'ok', error: null });
  const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
  const manifest = (await readManifest(generation))!;
  expect(manifest.accounts.map((account) => account.baseline)).toEqual([baseline]);
  expect(manifest.snapshots.map(({ id }) => id).toSorted()).toEqual([base, baseline, checkpoint].toSorted());
  const dir = emptyDir();
  await restoreGeneration(generation, dir, 'migrations', diskBucket(dir));
  const raw = openDatabase(join(dir, 'service.sqlite'));
  const db = serviceDb(raw);
  const stores = accountRegistry(dir, db, serviceReads(db), Date.now, diskBucket(dir));
  try {
    const timeline = (await db.prepare('SELECT timeline FROM accounts WHERE id = ?').bind(user.id).first<string>('timeline'))!;
    expect(await stores.getByName(user.incarnation).batch(user.incarnation, timeline, [{ id: X, kind: 'chat', parent: null, body: 'after the restore', baseRev: null }], null)).toMatchObject({ revs: [3] });
    const { taken } = (await stores.snapshot(user.incarnation)) as { taken: string };
    expect(await db.prepare('SELECT base FROM snapshots WHERE id = ?').bind(taken).first('base')).toBeNull();
    const target = join(dir, 'materialized.sqlite');
    await materializeSnapshot(diskBucket(dir), db, user.incarnation, taken, target);
    const rows = 'SELECT id, rev, body FROM objects ORDER BY id';
    const file = new DatabaseSync(target, { readOnly: true });
    try {
      expect(file.prepare(rows).all().map((row) => ({ ...row }))).toEqual(stores.inspect(user.incarnation).exec(rows));
    } finally {
      file.close();
    }
  } finally {
    stores.close();
    raw.close();
  }
}, 30_000);

it('names and restores the checkpoint of an account past its fence whose only baseline is from before migration 0007, and cancels the operation', async () => {
  const user = await t.signUp('fenced');
  const write = (body: string) => t.stores.getByName(user.incarnation).batch(user.incarnation, user.timeline, [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body, baseRev: null }], null);
  const day = dayStart(Date.now()) - DAY_MS;
  await write('in the baseline');
  t.clock.now = () => day + HOUR_MS;
  const baseline = ((await t.stores.snapshot(user.incarnation)) as { taken: string }).taken;
  await write('after the baseline, in the checkpoint');
  t.clock.now = () => day + 3 * HOUR_MS;
  const post = await t.askOperator(user.id);
  const operation = ((await beginRestore(t.env, user.id, post, { at: day + 2 * HOUR_MS })) as { begun: number }).begun;
  await expect(runRestore(stoppingAt('targeted'), operation)).rejects.toThrow(Stop);
  const checkpoint = (await t.env.db.prepare('SELECT checkpoint FROM restores WHERE id = ?').bind(operation).first<string>('checkpoint'))!;
  await t.env.db.prepare('UPDATE snapshots SET timeline = NULL, schema_version = NULL WHERE id = ?').bind(baseline).run();
  const rows = 'SELECT id, rev, body FROM objects ORDER BY id';
  const live = t.stores.inspect(user.incarnation).exec(rows);
  expect(live).toHaveLength(2);

  expect((await t.daily(day + 4 * HOUR_MS)).generation).toEqual({ outcome: 'ok', error: null });
  const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
  expect((await readManifest(generation))!.accounts.find(({ incarnation }) => incarnation === user.incarnation)!.baseline).toBe(checkpoint);
  const dir = emptyDir();
  expect((await restoreGeneration(generation, dir, 'migrations', diskBucket(dir))).operations).toEqual([{ id: operation, phase: 'cancelled' }]);
  const raw = openDatabase(join(dir, 'service.sqlite'));
  const db = serviceDb(raw);
  const stores = accountRegistry(dir, db, serviceReads(db), Date.now, diskBucket(dir));
  try {
    expect(stores.inspect(user.incarnation).exec(rows)).toEqual(live);
  } finally {
    stores.close();
    raw.close();
  }
}, 30_000);

it('restores version 2 and 3 generations, whose snapshots are all whole, and refuses a version it does not know', async () => {
  await t.signUp('operator');
  expect((await t.daily(Date.now())).generation).toEqual({ outcome: 'ok', error: null });
  const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
  const written = readFileSync(join(generation, MANIFEST), 'utf8');
  writeFileSync(join(generation, MANIFEST), written.replace('{"version":4,', '{"version":5,'));
  await expect(restoreGeneration(generation, emptyDir(), 'migrations', diskBucket(emptyDir()))).rejects.toThrow('restore: manifest version 5 is not one this build reads');
  writeFileSync(join(generation, MANIFEST), written.replace('{"version":4,', '{"version":2,'));
  for (const version of [2, 3]) {
    writeFileSync(join(generation, MANIFEST), written.replace('{"version":4,', `{"version":${version},`));
    const dir = emptyDir();
    expect(await restoreGeneration(generation, dir, 'migrations', diskBucket(dir))).toMatchObject({ accounts: [{ username: 'operator' }] });
  }
}, 30_000);

it('names R2 snapshots in v4, supports a local store restore and a pooled disaster restore, and checks pictures by listed size', async () => {
  const s3 = await fakeS3();
  const disk = t.env.files;
  t.env.files = r2Bucket(s3.config);
  t.restartProcess();
  try {
    const operator = await t.signUp('operator');
    const kept = bytesOf('a kept picture');
    expect((await t.put(`files/${sha256Hex(kept)}`, kept, operator.cookie)).status).toBe(204);
    const leaver = await t.signUp('leaver');
    expect((await t.put(`files/${sha256Hex(bytesOf('leaving'))}`, bytesOf('leaving'), leaver.cookie)).status).toBe(204);
    await t.lifecycle(leaver.id, "state = 'leaving'");
    expect((await t.daily(Date.now())).generation).toEqual({ outcome: 'ok', error: null });
    const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
    expect(await readManifest(generation)).toMatchObject({ version: 4, bucket: 'r2', snapshotStore: { kind: 'r2', bucket: s3.config.bucket }, pictures: [sha256Hex(bytesOf('leaving')), sha256Hex(kept)].sort() });
    expect(readdirSync(join(generationsDir(t.dir), POOL))).toEqual([]);
    expect(existsSync(join(generation, 'snapshots'))).toBe(false);
    // Local rollback explicitly reads the store; a disaster download below can restore after that store loses archives.
    expect(await restoreGeneration(generation, emptyDir(), 'migrations', r2Bucket(s3.config), { fromStore: true })).toMatchObject({ accounts: [{ username: 'operator' }] });
    const manifest = (await readManifest(generation))!;
    for (const snapshot of manifest.snapshots) {
      await diskBucket(generation).put(snapshot.path, s3.objects.get(snapshot.path)!);
      s3.objects.delete(snapshot.path);
    }

    await expect(restoreGeneration(generation, emptyDir(), 'migrations', diskBucket(emptyDir()))).rejects.toThrow(/HAZELLE_FILES_BUCKET=r2/);
    const keptKey = `files/${operator.incarnation}/${sha256Hex(kept)}`;
    const held = s3.objects.get(keptKey)!;
    s3.objects.delete(keptKey);
    const refused = emptyDir();
    await expect(restoreGeneration(generation, refused, 'migrations', r2Bucket(s3.config))).rejects.toThrow(`restore: 1 of 2 pictures are not in the R2 bucket as the generation names them:\n${keptKey}: missing`);
    expect(readdirSync(refused)).toEqual([]);

    s3.objects.set(keptKey, held);
    const dir = emptyDir();
    s3.requests.length = 0;
    expect(await restoreGeneration(generation, dir, 'migrations', r2Bucket(s3.config))).toMatchObject({ accounts: [{ username: 'operator' }], pictures: 1, deleted: 1 });
    expect(s3.requests.filter((request) => request.startsWith('HEAD '))).toEqual([]);
    expect(existsSync(join(dir, 'files'))).toBe(false);
    const raw = openDatabase(join(dir, 'service.sqlite'));
    try {
      expect(raw.prepare('SELECT incarnation FROM picture_removals').all()).toEqual([{ incarnation: leaver.incarnation }]);
    } finally {
      raw.close();
    }
    expect([...s3.objects.keys()].filter((key) => key.startsWith('files/')).sort()).toEqual([keptKey, `files/${leaver.incarnation}/${sha256Hex(bytesOf('leaving'))}`].sort());
  } finally {
    t.env.files = disk;
    t.restartProcess();
    await s3.close();
  }
}, 30_000);

it('restores a disk generation into the R2 bucket by putting its pooled pictures there', async () => {
  const s3 = await fakeS3();
  try {
    const operator = await t.signUp('operator');
    const kept = bytesOf('a pooled picture');
    expect((await t.put(`files/${sha256Hex(kept)}`, kept, operator.cookie)).status).toBe(204);
    const outcome = await t.daily(Date.now());
    expect(outcome.generation, JSON.stringify(await t.env.db.prepare('SELECT detail FROM backup_runs').all())).toEqual({ outcome: 'ok', error: null });
    const generation = join(generationsDir(t.dir), (await listGenerations(t.dir))[0]!.id);
    expect((await readManifest(generation))!.bucket).toBe('disk');
    const dir = emptyDir();
    expect(await restoreGeneration(generation, dir, 'migrations', r2Bucket(s3.config))).toMatchObject({ accounts: [{ username: 'operator' }], pictures: 1 });
    expect([...s3.objects.keys()].filter((key) => key.startsWith('files/'))).toEqual([`files/${operator.incarnation}/${sha256Hex(kept)}`]);
    expect(s3.objects.get(`files/${operator.incarnation}/${sha256Hex(kept)}`)).toEqual(kept);
    expect(existsSync(join(dir, 'files'))).toBe(false);
  } finally {
    await s3.close();
  }
}, 30_000);
