import { rmSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BEFORE_ARMED, type RestorePhase } from '../contracts/admin';
import type { SealedWrite } from '../contracts/objects';
import { expireSnapshots } from './backup/snapshots';
import { snapshotFor, type Stores } from './db/account-db';
import type { Db, Result, Statement } from './db/service-db';
import { MAX_FILE_BYTES } from '../contracts/files';
import { snapshotKey, type Bucket } from './files/bucket';
import { diskBucket } from './files/disk-bucket';
import { sha256Hex, type Services } from './http';
import { beginRestore, cancelRestore, leaveAccount, restorePoints, runRestore } from './lifecycle';
import { sessionCookie, signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(fresh);

// The installation's sole operator: the first signup after every reset, so any other account can be deleted.
let operator: Awaited<ReturnType<typeof t.signUp>>;
async function fresh() {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 1000').run();
  operator = await t.signUp('operator');
}

const HOUR_MS = 3_600_000;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const BEFORE: Record<string, string> = { [A]: 'new', [B]: 'b' };
const AT_TARGET: Record<string, string> = { [A]: 'old' };

class Crash extends Error {}

// hook runs after each durable boundary: throw simulates crash, wait pauses the runner.
// After a throw every later call must fail, even though production intentionally swallows restart failures.
// arms/checkpoints record only store calls/writes that actually landed.
function watched(hook: (what: string) => void | Promise<void>, reads = false) {
  const arms: string[] = [];
  let checkpoints = 0;
  let dead: unknown = null;
  const alive = () => {
    if (dead) throw dead;
  };
  const boundary = async (what: string) => {
    try {
      await hook(what);
    } catch (error) {
      dead = error;
      throw error;
    }
  };
  const statement = (real: Statement, sql: string): Statement => {
    const writes = /^\s*(INSERT|UPDATE|DELETE)/i.test(sql);
    const after = async <T>(done: () => Promise<T>) => {
      alive();
      const value = await done();
      if (/checkpoint = \?/.test(sql)) checkpoints += (value as Result).meta.changes;
      if (writes || reads) await boundary(`db ${sql.trim().slice(0, 40)}`);
      return value;
    };
    return {
      real,
      bind: (...values: Parameters<Statement['bind']>) => statement(real.bind(...values), sql),
      run: () => after(() => real.run()),
      all: () => after(() => real.all()),
      first: (...column: [string?]) => after(() => real.first(...(column as [string]))),
    } as unknown as Statement;
  };
  const db: Db = {
    ...t.env.db,
    prepare: (sql) => statement(t.env.db.prepare(sql), sql),
    // The service runs a batch through the real statements' own handle, which the wrappers do not carry.
    batch: async (list) => {
      alive();
      const results = await t.env.db.batch(list.map((item) => (item as unknown as { real: Statement }).real));
      await boundary('db batch');
      return results as never;
    },
  };
  const stores: Stores = {
    ...t.env.stores,
    getByName: (name) => {
      const stub = t.env.stores.getByName(name) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
      return new Proxy(
        {},
        {
          get: (_, method) =>
            typeof method !== 'string' || method === 'then'
              ? undefined
              : async (...args: unknown[]) => {
                  alive();
                  if (method === 'arm') arms.push(args[2] as string);
                  const settled = await stub[method]!(...args).then(
                    (value) => ({ value }),
                    (error: unknown) => ({ error }),
                  );
                  await boundary(`store ${method}`);
                  if ('error' in settled) throw settled.error;
                  return settled.value;
                },
        },
      ) as ReturnType<Stores['getByName']>;
    },
  };
  const files: Bucket = {
    ...t.env.files,
    deletePrefix: async (prefix) => {
      alive();
      await t.env.files.deletePrefix(prefix);
      await boundary('files deletePrefix');
    },
  };
  return { env: { ...t.env, db, stores, files } satisfies Services, arms, checkpoints: () => checkpoints };
}

// A deletion with the work it leaves running after its answer awaited, so a crash there fails the run too.
async function leave(on: Services, id: string, incarnation: string, operator: boolean) {
  const after: Promise<unknown>[] = [];
  const left = await leaveAccount(on, { waitUntil: (work) => void after.push(work) }, id, incarnation, operator);
  await Promise.all(after);
  return left;
}

const counting = () => {
  let count = 0;
  return { ...watched(() => void count++), count: () => count };
};
const crashing = (n: number) => {
  let count = 0;
  return watched((what) => {
    if (++count === n) throw new Crash(what);
  });
};
function pausing(at: (what: string, count: number) => boolean, reads = false) {
  let count = 0;
  let reach = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const watching = watched(async (what) => {
    if (!at(what, ++count)) return;
    reach();
    await released;
  }, reads);
  return { ...watching, reached, release };
}

// An account whose store holds A 'old' from an hour ago, kept in a baseline snapshot, then A 'new' and B from half an
// hour ago, and an open post. at: a time between the two, so a restore to it leaves A 'old' alone.
async function seeded() {
  const now = Date.now();
  t.clock.now = () => now - HOUR_MS;
  const user = await t.signUp();
  const { incarnation, timeline } = user;
  // Straight to the store, as the batch route would: these tests are about what happens around it.
  const write = (...writes: SealedWrite[]) => t.stores.getByName(incarnation).batch(incarnation, timeline, writes, null);
  await write({ id: A, kind: 'chat', parent: null, body: 'old', baseRev: null });
  await t.stores.snapshot(incarnation);
  t.clock.now = () => now - HOUR_MS / 2;
  await write({ id: A, kind: 'chat', parent: null, body: 'new', baseRev: 1 }, { id: B, kind: 'chat', parent: null, body: 'b', baseRev: null });
  t.clock.now = () => Date.now();
  const post = await asked(user.id);
  return { ...user, post, at: now - (3 * HOUR_MS) / 4 };
}

const asked = (accountId: string) => t.askOperator(accountId);

const account = (id: string) => t.env.db.prepare('SELECT incarnation, state, timeline, operation FROM accounts WHERE id = ?').bind(id).first<{ incarnation: string; state: string; timeline: string; operation: number | null }>();
const operation = (id: number) => t.env.db.prepare('SELECT phase, verified, target, error FROM restores WHERE id = ?').bind(id).first<{ phase: RestorePhase; verified: number; target: string | null; error: string | null }>();
const logged = async (action: string, operation?: number) =>
  (await t.env.db
    .prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = ?1 AND (?2 IS NULL OR json_extract(detail, '$.operation') = ?2)")
    .bind(action, operation ?? null)
    .first<number>('n'))!;
const mark = (incarnation: string, id: number) => t.stores.inspect(incarnation).exec('SELECT value FROM kv WHERE key = ?', `restore:${id}`);

async function contents(cookie: string) {
  const { changes } = (await (await t.get('objects?since=0', cookie)).json()) as { changes: { id: string; body: string | null }[] };
  return Object.fromEntries(changes.filter(({ body }) => body !== null).map(({ id, body }) => [id, body]));
}

async function begin(seed: Awaited<ReturnType<typeof seeded>>, from: { at: number } | { undoes: number } = { at: seed.at }) {
  const begun = await beginRestore(t.env, seed.id, seed.post, from);
  if (!('begun' in begun)) throw new Error(`refused: ${begun.refused}`);
  return begun.begun;
}

// Its checkpoint holds the state the restore replaced: an undo of it gives that state back, which ends the restore's
// use in the test.
async function expectRestored(seed: Awaited<ReturnType<typeof seeded>>, id: number, arms: string[]) {
  const ended = (await operation(id))!;
  expect(ended).toMatchObject({ phase: 'done', verified: 1, error: null });
  expect(arms.every((target) => target === ended.target)).toBe(true);
  expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });
  expect((await account(seed.id))!.timeline).not.toBe(seed.timeline);
  expect(await contents(seed.cookie)).toEqual(AT_TARGET);
  expect(await logged('restore-done', id)).toBe(1);
  expect(await runRestore(t.env, await begin(seed, { undoes: id }))).toMatchObject({ phase: 'done', verified: true, error: null });
  expect(await contents(seed.cookie)).toEqual(BEFORE);
}

describe('a restore', () => {
  it('recovers the begun operation and its account hold after the begin batch commits without returning', async () => {
    const seed = await seeded();
    await expect(beginRestore(crashing(1).env, seed.id, seed.post, { at: seed.at })).rejects.toThrow(Crash);
    t.restartProcess();
    const row = (await account(seed.id))!;
    expect(row).toMatchObject({ state: 'restoring', operation: expect.any(Number) });
    expect(await operation(row.operation!)).toMatchObject({ phase: 'begun', verified: 0 });
    expect(await logged('restore-begun', row.operation!)).toBe(1);
    await expectRestored(seed, (await runRestore(t.env, row.operation!))!.id, []);
  });

  it('lets only one simultaneous begin acquire the account and write its operation and log', async () => {
    const seed = await seeded();
    const answers = await Promise.all([beginRestore(t.env, seed.id, seed.post, { at: seed.at }), beginRestore(t.env, seed.id, seed.post, { at: seed.at })]);
    expect(answers.filter((answer) => 'begun' in answer)).toHaveLength(1);
    expect(answers.filter((answer) => 'refused' in answer)).toEqual([{ refused: 'account-busy' }]);
    expect(await t.env.db.prepare('SELECT COUNT(*) AS n FROM restores').first('n')).toBe(1);
    expect(await logged('restore-begun')).toBe(1);
    expect(await account(seed.id)).toMatchObject({ state: 'restoring', operation: (answers.find((answer) => 'begun' in answer) as { begun: number }).begun });
  });

  it('follows cancellation after reading a checkpointed operation without arming or changing its timeline', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('checkpointed').env, id)).rejects.toThrow(Crash);
    const late = pausing((what) => what.startsWith('db SELECT id, incarnation, at,'), true);
    const running = runRestore(late.env, id);
    await late.reached;
    try {
      expect(await cancelRestore(t.env, id)).toMatchObject({ phase: 'cancelled', verified: true });
    } finally {
      late.release();
    }
    expect(await running).toEqual({ id, phase: 'cancelled', verified: true, error: null });
    expect(late.arms).toEqual([]);
    expect(await account(seed.id)).toMatchObject({ timeline: seed.timeline, state: 'active', operation: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
  });

  it('writes one cancellation log when two cancels compete for the terminal phase', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, id)).rejects.toThrow(Crash);
    const answers = await Promise.all([cancelRestore(t.env, id), cancelRestore(t.env, id)]);
    for (const answer of answers) expect(answer).toMatchObject({ phase: 'cancelled', verified: true, error: null });
    expect(await logged('restore-cancelled', id)).toBe(1);
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect(mark(seed.incarnation, id)).toEqual([]);
  });

  it('finalizes cancellation after unmark committed but verification did not', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, id)).rejects.toThrow(Crash);
    const cut = watched((what) => {
      if (what === 'store unmark') throw new Crash(what);
    });
    await expect(cancelRestore(cut.env, id)).rejects.toThrow(Crash);
    expect(await operation(id)).toMatchObject({ phase: 'cancelled', verified: 0 });
    expect(mark(seed.incarnation, id)).toEqual([]);
    t.restartProcess();
    expect(await runRestore(t.env, id)).toEqual({ id, phase: 'cancelled', verified: true, error: null });
    expect(await logged('restore-cancelled', id)).toBe(1);
    expect(await contents(seed.cookie)).toEqual(BEFORE);
  });

  it('finalizes a too-early failure after its release batch commits without returning', async () => {
    const seed = await seeded();
    const id = await begin(seed, { at: seed.at - HOUR_MS });
    const cut = watched(async (what) => {
      if (what === 'db batch' && (await operation(id))?.phase === 'failed') throw new Crash(what);
    });
    await expect(runRestore(cut.env, id)).rejects.toThrow(Crash);
    expect(await operation(id)).toMatchObject({ phase: 'failed', verified: 0, error: 'too-early' });
    t.restartProcess();
    expect(await runRestore(t.env, id)).toEqual({ id, phase: 'failed', verified: true, error: 'too-early' });
    expect(await logged('restore-failed', id)).toBe(1);
    expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline, operation: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
  });

  it.each([
    ['absent mark without an install', { marked: false, installedFrom: null, installedOp: null }],
    ['matching target installed by another operation', { marked: false, installedFrom: 'target', installedOp: -1 }],
    ['matching operation installed from another target', { marked: false, installedFrom: 'other', installedOp: 'operation' }],
    ['matching install with the operation mark still present', { marked: true, installedFrom: 'target', installedOp: 'operation' }],
  ] as const)('does not accept %s as proof of rewind', async (_, proof) => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('armed').env, id)).rejects.toThrow(Crash);
    const { target } = (await operation(id))!;
    let observed = false;
    const env: Services = {
      ...t.env,
      stores: {
        ...t.stores,
        getByName: (name) => new Proxy(t.stores.getByName(name), {
          get: (stub, method) => {
            if (method === 'marked') return async () => ({ ...proof, installedFrom: proof.installedFrom === 'target' ? target : proof.installedFrom, installedOp: proof.installedOp === 'operation' ? id : proof.installedOp });
            if (method === 'arm') return async () => {
              observed = true;
              expect(await operation(id)).toMatchObject({ phase: 'armed', verified: 0 });
              throw new Crash('arm');
            };
            return Reflect.get(stub, method);
          },
        }),
      },
    };
    await expect(runRestore(env, id)).rejects.toThrow(Crash);
    expect(observed).toBe(true);
    expect(await logged('restore-done', id)).toBe(0);
    t.restartProcess();
    await expectRestored(seed, (await runRestore(t.env, id))!.id, []);
  });

  it('stops after three unreached rewind restarts and resumes the armed target once restarts reach the store', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('armed').env, id)).rejects.toThrow(Crash);
    const probe = counting();
    let restarts = 0;
    const env: Services = {
      ...probe.env,
      stores: {
        ...probe.env.stores,
        getByName: (name) => new Proxy(probe.env.stores.getByName(name), {
          get: (stub, method) => method === 'restart' ? async () => { restarts++; throw new Error('unreached'); } : Reflect.get(stub, method),
        }),
      },
    };
    expect(await runRestore(env, id)).toEqual({ id, phase: 'armed', verified: false, error: 'not-rewound' });
    expect(restarts).toBe(3);
    expect(probe.arms).toHaveLength(3);
    expect(await account(seed.id)).toMatchObject({ state: 'restoring', operation: id });
    await expectRestored(seed, (await runRestore(t.env, id))!.id, probe.arms);
  });

  it('clears a committed not-verified error when finalization resumes after its restart reaches the store', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('done').env, id)).rejects.toThrow(Crash);
    const cut = watched((what) => {
      if (what.startsWith('db UPDATE restores SET error')) throw new Crash(what);
    });
    const env: Services = {
      ...cut.env,
      stores: {
        ...cut.env.stores,
        getByName: (name) => new Proxy(cut.env.stores.getByName(name), {
          get: (stub, method) => method === 'restart' ? async () => { throw new Error('unreached'); } : Reflect.get(stub, method),
        }),
      },
    };
    await expect(runRestore(env, id)).rejects.toThrow(Crash);
    expect(await operation(id)).toMatchObject({ phase: 'done', verified: 0, error: 'not-verified' });
    t.restartProcess();
    await expectRestored(seed, (await runRestore(t.env, id))!.id, []);
  });

  it('lists what a restore can land on: each snapshot in the window at its own time, and an older one at the window edge', async () => {
    const user = await t.signUp();
    const now = Date.now();
    const write = (...writes: SealedWrite[]) => t.stores.getByName(user.incarnation).batch(user.incarnation, user.timeline, writes, null);
    t.clock.now = () => now - 8 * 24 * HOUR_MS;
    await write({ id: A, kind: 'chat', parent: null, body: 'old', baseRev: null });
    await t.stores.snapshot(user.incarnation);
    t.clock.now = () => now - HOUR_MS;
    await write({ id: A, kind: 'chat', parent: null, body: 'new', baseRev: 1 });
    await t.stores.snapshot(user.incarnation);
    t.clock.now = () => Date.now();
    const points = (await restorePoints(t.env.db, user.id, now))!;
    expect(points).toEqual([
      { at: now - HOUR_MS, takenAt: now - HOUR_MS, kind: 'baseline' },
      { at: expect.any(Number), takenAt: now - 8 * 24 * HOUR_MS, kind: 'baseline' },
    ]);
    for (const point of points) expect((await snapshotFor(t.env.files, t.env.db, user.incarnation, point.at))?.takenAt).toBe(point.takenAt);
  });

  it('takes back the pictures released since the snapshot it lands on, with their bytes counted again, and leaves older releases', async () => {
    const seed = await seeded();
    const now = Date.now();
    const [before, since] = ['e'.repeat(64), 'f'.repeat(64)];
    await t.env.db
      .prepare('INSERT INTO file_removals (incarnation, id, size, created_at, released_at, due_at) VALUES (?1, ?2, 3, 0, ?3, ?4), (?1, ?5, 5, 0, ?6, ?4)')
      .bind(seed.incarnation, before, now - 2 * HOUR_MS, now + 24 * HOUR_MS, since, now - HOUR_MS / 4)
      .run();
    expect(await runRestore(t.env, await begin(seed))).toMatchObject({ phase: 'done', verified: true, error: null });
    const rows = (sql: string) => t.env.db.prepare(sql).bind(seed.incarnation).all().then(({ results }) => results);
    expect(await rows('SELECT id, size, stored FROM account_files WHERE incarnation = ?')).toEqual([{ id: since, size: 5, stored: 1 }]);
    expect(await rows('SELECT id FROM file_removals WHERE incarnation = ?')).toEqual([{ id: before }]);
    expect(await rows('SELECT file_bytes FROM accounts WHERE incarnation = ?')).toEqual([{ file_bytes: 5 }]);
  });

  it('leaves a failed upload retryable through a sweep and rewind instead of claiming its absent bytes are stored', async () => {
    const seed = await seeded();
    const body = new Uint8Array([8, 8, 8]);
    const id = sha256Hex(body);
    const files = t.env.files;
    t.env.files = { ...files, put: async () => { throw new Error('upload interrupted'); } };
    try {
      expect((await t.put(`files/${id}`, body, seed.cookie)).status).toBe(500);
    } finally {
      t.env.files = files;
    }
    await t.env.db.prepare('UPDATE account_files SET claimed_at = 0').run();
    const inventory = await (await t.get('files', seed.cookie)).json() as { timeline: string; rev: number };
    expect(await (await t.post('files/sweep', { ...inventory, unused: [id], named: [] }, seed.cookie)).json()).toEqual({ released: 0, taken: 0 });
    expect(await runRestore(t.env, await begin(seed))).toMatchObject({ phase: 'done', verified: true });
    expect(await (await t.post('files/missing', { ids: [id] }, seed.cookie)).json()).toMatchObject({ missing: [id] });
    expect((await t.put(`files/${id}`, body, seed.cookie)).status).toBe(204);
    expect(new Uint8Array(await (await t.get(`files/${id}`, seed.cookie)).arrayBuffer())).toEqual(body);
    expect(await t.env.db.prepare('SELECT file_bytes FROM accounts WHERE incarnation = ?').bind(seed.incarnation).first('file_bytes')).toBe(3);
  });

  it('lets an account rewind itself and undo it, three times a day, and touch only its own restores', async () => {
    const seed = await seeded();
    const other = await seeded();
    const begin = (body: object) => t.post('account/restores', body, seed.cookie);
    const { id } = (await (await begin({ at: seed.at })).json()) as { id: number };
    expect(await contents(seed.cookie)).toEqual(AT_TARGET);
    expect(((await (await t.get('account/restores', seed.cookie)).json()) as { restores: unknown[] }).restores).toMatchObject([{ id, postId: null, phase: 'done', canUndo: true }]);
    expect(((await (await t.get('account/restores', other.cookie)).json()) as { restores: unknown[] }).restores).toEqual([]);
    expect((await t.post(`account/restores/${id}/finalize`, {}, other.cookie)).status).toBe(404);

    expect(await (await begin({ undoes: id })).json()).toMatchObject({ phase: 'done', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect((await begin({ at: seed.at })).status).toBe(200);
    const fourth = await begin({ at: seed.at });
    expect([fourth.status, await fourth.json()]).toEqual([429, { error: 'too-many-restores' }]);
    // The operator is not held to it.
    expect((await t.post(`admin/accounts/${seed.id}/restores`, { post: seed.post, at: seed.at }, operator.cookie)).status).toBe(200);
  });

  it('runs in the operator request, is listed with its undo, and its undo gives back the state it replaced', async () => {
    const seed = await seeded();
    const restored = await t.post(`admin/accounts/${seed.id}/restores`, { post: seed.post, at: seed.at }, operator.cookie);
    const { id } = (await restored.json()) as { id: number };
    expect(await contents(seed.cookie)).toEqual(AT_TARGET);
    const listed = (await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as { restores: Record<string, unknown>[] };
    expect(listed.restores).toEqual([
      { id, postId: seed.post, at: seed.at, undoes: null, targetAt: seed.at - HOUR_MS / 4, phase: 'done', verified: true, error: null, createdAt: expect.any(Number), updatedAt: expect.any(Number), canUndo: true, undoExpiresAt: expect.any(Number), actions: [] },
    ]);

    const post = await asked(seed.id);
    const undone = await t.post(`admin/accounts/${seed.id}/restores`, { post, undoes: id }, operator.cookie);
    expect(await undone.json()).toEqual({ id: expect.any(Number), phase: 'done', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    const relisted = (await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as { restores: { undoes: number | null; canUndo: boolean }[] };
    expect(relisted.restores.map(({ undoes, canUndo }) => ({ undoes, canUndo }))).toEqual([{ undoes: id, canUndo: true }, { undoes: null, canUndo: false }]);
    expect(await t.env.db.prepare("SELECT action, detail FROM admin_log WHERE action LIKE 'restore-%' ORDER BY id").all()).toMatchObject({
      results: [{ action: 'restore-begun' }, { action: 'restore-done' }, { action: 'restore-begun', detail: expect.stringContaining(`"undoes":${id}`) }, { action: 'restore-done' }],
    });
  });

  it('begins only on an open post the account sent, a time 10 minutes to 6 days back, or an undo of its latest restore; a refusal leaves no row and no hold', async () => {
    const seed = await seeded();
    const other = await seeded();
    const refused = async (post: number, from: { at: number } | { undoes: number }) => {
      const begun = await beginRestore(t.env, seed.id, post, from);
      return 'refused' in begun ? begun.refused : 'begun';
    };
    expect(await refused(other.post, { at: seed.at })).toBe('bad-post');
    expect(await refused(seed.post + 100, { at: seed.at })).toBe('bad-post');
    expect(await refused(seed.post, { at: Date.now() - 5 * 60_000 })).toBe('bad-time');
    expect(await refused(seed.post, { at: Date.now() - 7 * 24 * HOUR_MS })).toBe('bad-time');
    expect(await refused(seed.post, { undoes: 1 })).toBe('cannot-undo');
    await t.env.db.prepare("UPDATE posts SET status = 'done' WHERE id = ?").bind(seed.post).run();
    expect(await refused(seed.post, { at: seed.at })).toBe('bad-post');
    expect(await t.env.db.prepare('SELECT COUNT(*) AS n FROM restores').first('n')).toBe(0);
    expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });

    await t.env.db.prepare("UPDATE posts SET status = 'open'").run();
    await begin(other);
    expect(await beginRestore(t.env, other.id, other.post, { at: other.at })).toEqual({ refused: 'account-busy' });
    expect(await logged('restore-begun')).toBe(1);
  });

  it('allows the undo for 7 days after the restore ended, however long before that its checkpoint was taken', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const now = Date.now();
    await t.env.db.prepare('UPDATE restores SET checkpoint_at = ?, ended_at = ? WHERE id = ?').bind(now - 12 * 24 * HOUR_MS, now - 6 * 24 * HOUR_MS, id).run();
    const listed = (await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as { restores: { undoExpiresAt: number }[] };
    expect(listed.restores[0]!.undoExpiresAt).toBe(now + 24 * HOUR_MS);
    await t.env.db.prepare('UPDATE restores SET ended_at = ? WHERE id = ?').bind(now - 7 * 24 * HOUR_MS - 60_000, id).run();
    expect(await beginRestore(t.env, seed.id, seed.post, { undoes: id })).toEqual({ refused: 'cannot-undo' });
    await t.env.db.prepare('UPDATE restores SET ended_at = ? WHERE id = ?').bind(now - 6 * 24 * HOUR_MS, id).run();
    expect(await beginRestore(t.env, seed.id, seed.post, { undoes: id })).toHaveProperty('begun');
  });

  it('keeps the checkpoint an undo will install pinned from its begin, past the end of the undone restore’s own pin', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const undo = await begin({ ...seed, post: await asked(seed.id) }, { undoes: id });
    t.restartProcess();
    // 8 days on, the undone restore's own pin has lapsed.
    await expireSnapshots(t.env, t.dir, Date.now() + 8 * 24 * HOUR_MS, new Map());
    expect(await runRestore(t.env, undo)).toMatchObject({ phase: 'done', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
  });

  it('stops an undo whose checkpoint is lost before arming it, and lets it be cancelled', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const { checkpoint } = (await t.env.db.prepare('SELECT checkpoint FROM restores WHERE id = ?').bind(id).first<{ checkpoint: string }>())!;
    rmSync(diskBucket(t.dir).path(snapshotKey(seed.incarnation, checkpoint)));
    const undo = await begin({ ...seed, post: await asked(seed.id) }, { undoes: id });
    expect(await runRestore(t.env, undo)).toEqual({ id: undo, phase: 'checkpointed', verified: false, error: 'store-unavailable' });
    expect(await cancelRestore(t.env, undo)).toMatchObject({ phase: 'cancelled', verified: true });
    expect(await contents(seed.cookie)).toEqual(AT_TARGET);
  });

  it('cancels before arming, giving the account back on its timeline with its objects, and refuses once armed', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, id)).rejects.toThrow(Crash);
    expect((await operation(id))!.phase).toBe('targeted');
    expect(await cancelRestore(t.env, id)).toEqual({ id, phase: 'cancelled', verified: true, error: null });
    expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline, operation: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect(mark(seed.incarnation, id)).toEqual([]);
    expect(await cancelRestore(t.env, id)).toMatchObject({ phase: 'cancelled' });
    expect(await logged('restore-cancelled')).toBe(1);

    const armed = await begin(seed);
    await expect(runRestore(pausedAt('armed').env, armed)).rejects.toThrow(Crash);
    expect(await cancelRestore(t.env, armed)).toBe('too-late');
    await expectRestored(seed, (await runRestore(t.env, armed))!.id, []);
  });

  it('repairs, by finalizing, a store left refusing as restoring by a cancel cut off before its restart', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('targeted').env, id)).rejects.toThrow(Crash);
    await expect(cancelRestore(crashing(1).env, id)).rejects.toThrow(Crash);
    expect(await account(seed.id)).toMatchObject({ state: 'active', operation: null });
    expect((await t.get('objects?since=0', seed.cookie)).status).toBe(503);
    expect(await runRestore(t.env, id)).toEqual({ id, phase: 'cancelled', verified: true, error: null });
    expect(await contents(seed.cookie)).toEqual(BEFORE);
    expect(mark(seed.incarnation, id)).toEqual([]);
  });

  it('fails one asking for a time before the store existed, giving the account back', async () => {
    const seed = await seeded();
    const early = await beginRestore(t.env, seed.id, seed.post, { at: seed.at - HOUR_MS });
    expect(await runRestore(t.env, (early as { begun: number }).begun)).toMatchObject({ phase: 'failed', verified: true, error: 'too-early' });
    expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline });
    expect(await logged('restore-failed')).toBe(1);
  });

  it('never lands a later restore on a snapshot taken before a finished one, until the daily job takes a baseline after it, though the file holds that baseline’s revision', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await runRestore(t.env, id);
    const later = Date.now() + 1;
    expect(await snapshotFor(t.env.files, t.env.db, seed.incarnation, later)).toBeNull();
    const recorded = await t.env.db.prepare("SELECT rev FROM snapshots WHERE incarnation = ? AND kind = 'baseline'").bind(seed.incarnation).first<number>('rev');
    expect(t.stores.inspect(seed.incarnation).exec<{ rev: number }>('SELECT rev FROM head')).toEqual([{ rev: recorded }]);
    expect(await t.daily(later)).toMatchObject({ snapshots: { outcome: 'ok' } });
    expect(await snapshotFor(t.env.files, t.env.db, seed.incarnation, later)).toEqual({ id: expect.any(String), takenAt: later });
  });

  it('lets no write or answer of an old timeline back in across a rewind, revisions after it and its undo', async () => {
    const seed = await seeded();
    const write = (timeline: string, id: string, body: string, baseRev: number | null) =>
      t.post('objects/batch', { timeline, files: [], writes: [{ id, kind: 'chat', parent: null, body, baseRev }] }, seed.cookie);
    // The offline tab: its write and its feed both name the timeline it last pulled.
    const held = () => write(seed.timeline, A, 'offline edit', 2);
    const heldFeed = () => t.get(`objects?since=0&timeline=${seed.timeline}`, seed.cookie);
    const id = await begin(seed);
    await runRestore(t.env, id);
    const rewound = (await account(seed.id))!.timeline;
    expect((await write(rewound, B, 'after', null)).status).toBe(200);
    expect((await write(rewound, B, 'after again', 2)).status).toBe(200);
    expect((await held()).status).toBe(409);
    expect((await heldFeed()).status).toBe(409);
    await runRestore(t.env, await begin({ ...seed, post: await asked(seed.id) }, { undoes: id }));
    expect((await held()).status).toBe(409);
    expect((await heldFeed()).status).toBe(409);
    expect((await write(rewound, B, 'late', 3)).status).toBe(409);
    expect(await contents(seed.cookie)).toEqual(BEFORE);
  });

  it('is finalized again and again once the store is seen on its new timeline', async () => {
    const seed = await seeded();
    const id = await begin(seed);
    await expect(runRestore(pausedAt('done').env, id)).rejects.toThrow(Crash);
    expect(await operation(id)).toMatchObject({ phase: 'done', verified: 0 });
    expect((await (await t.get(`admin/accounts/${seed.id}/restores`, operator.cookie)).json()) as object).toMatchObject({ restores: [{ id, actions: ['finalize'] }] });
    for (let i = 0; i < 2; i++) expect(await (await t.post(`admin/restores/${id}/finalize`, undefined, operator.cookie)).json()).toEqual({ id, phase: 'done', verified: true, error: null });
    await expectRestored(seed, id, []);
  });

  it('ends restored by two resumes at once, or cancelled when cancelled before arming, after a throw and a registry restart at every durable boundary', async () => {
    const probe = counting();
    await runRestore(probe.env, await begin(await seeded()));
    const total = probe.count();
    expect(total).toBeGreaterThan(10);
    // A crash that leaves the operation before armed is followed once by a resume and once by a cancel.
    const crashAt = async (n: number, cancel: boolean) => {
      const seed = await seeded();
      const id = await begin(seed);
      const crashed = crashing(n);
      await expect(runRestore(crashed.env, id)).rejects.toThrow(Crash);
      t.restartProcess();
      const { phase } = (await operation(id))!;
      const rerun = counting();
      if (cancel) {
        expect(await cancelRestore(rerun.env, id)).toMatchObject({ phase: 'cancelled', verified: true });
        expect(await account(seed.id)).toMatchObject({ state: 'active', timeline: seed.timeline, operation: null });
        expect(await contents(seed.cookie)).toEqual(BEFORE);
        expect(await logged('restore-cancelled', id)).toBe(1);
        return true;
      }
      const twin = counting();
      await Promise.all([runRestore(rerun.env, id), runRestore(twin.env, id)]);
      expect(crashed.checkpoints() + rerun.checkpoints() + twin.checkpoints()).toBe(1);
      await expectRestored(seed, id, [...crashed.arms, ...rerun.arms, ...twin.arms]);
      return BEFORE_ARMED.includes(phase);
    };
    const cancellable: number[] = [];
    for (let n = 1; n <= total; n++) if (await crashAt(n, false)) cancellable.push(n);
    expect(cancellable.length).toBeGreaterThan(3);
    for (const n of cancellable) await crashAt(n, true);
  }, 120_000);

  it('ends restored once when two runs of it interleave at every step, and leaves another operation alone', async () => {
    const probe = counting();
    await runRestore(probe.env, await begin(await seeded()));
    const total = probe.count();
    const other = await seeded();
    const held = await begin(other);
    // The first run pauses after its nth boundary while a second runs to its end; then the first goes on from what it
    // read before.
    for (let n = 1; n <= total; n++) {
      const seed = await seeded();
      const id = await begin(seed);
      const first = pausing((_, count) => count === n);
      const running = runRestore(first.env, id);
      await Promise.race([first.reached, running]);
      const second = counting();
      await runRestore(second.env, id);
      first.release();
      await running;
      expect(first.checkpoints() + second.checkpoints()).toBe(1);
      await expectRestored(seed, id, [...first.arms, ...second.arms]);
    }
    expect(await operation(held)).toMatchObject({ phase: 'begun', verified: 0 });
    expect(await account(other.id)).toMatchObject({ state: 'restoring', operation: held });
  }, 120_000);
});

describe('a deletion', () => {
  async function holding() {
    const user = await t.signUp();
    await t.batch([{ id: A, kind: 'chat', parent: null, body: 'sealed', baseRev: null }], user.cookie);
    const bytes = new Uint8Array([1, 2, 3]);
    const file = sha256Hex(bytes);
    expect((await t.put(`files/${file}`, bytes, user.cookie)).status).toBe(204);
    return { ...user, file, bytes };
  }

  const pictures = async ({ incarnation }: { incarnation: string }) => (await t.env.files.list(`files/${incarnation}/`)).length;

  const gone = async (held: { id: string; incarnation: string }) => {
    expect(await account(held.id)).toBeNull();
    expect(t.stores.inspect(held.incarnation).tables()).toEqual([]);
    expect(await pictures(held)).toBe(0);
  };

  it('finishes after a throw at every durable boundary, by running again or by the hourly reconciliation once the row is gone, and logs the deletion once', async () => {
    const probe = counting();
    const first = await holding();
    expect(await leave(probe.env, first.id, first.incarnation, true)).toBe('left');
    const total = probe.count();
    expect(total).toBeGreaterThan(4);
    for (let n = 1; n <= total; n++) {
      const held = await holding();
      await expect(leave(crashing(n).env, held.id, held.incarnation, true)).rejects.toThrow(Crash);
      t.restartProcess();
      expect(await leave(t.env, held.id, held.incarnation, true)).toBe('left');
      await t.reconcile(Date.now() + 2 * HOUR_MS);
      await gone(held);
      expect(await t.env.db.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'delete-account' AND target = ?").bind(held.id).first('n')).toBe(1);
    }
  }, 60_000);

  it('lets only one deletion intent write its log while a competing deletion finishes the account', async () => {
    const held = await holding();
    const first = pausing((what) => what === 'db batch');
    const leaving = leave(first.env, held.id, held.incarnation, true);
    await first.reached;
    try {
      expect(await leave(t.env, held.id, held.incarnation, true)).toBe('left');
    } finally {
      first.release();
    }
    expect(await leaving).toBe('left');
    await gone(held);
    expect(await t.env.db.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'delete-account' AND target = ?").bind(held.id).first('n')).toBe(1);
  });

  // The pictures' removal waits until released, as one still running after the answer.
  function heldDeletes() {
    const files = t.env.files;
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    t.env.files = {
      ...files,
      deletePrefix: async (prefix) => {
        await released;
        await files.deletePrefix(prefix);
      },
    };
    return () => {
      t.env.files = files;
      release();
    };
  }

  it('answers 탈퇴 once the store is emptied and the row gone, and removes the pictures after the answer', async () => {
    const held = await holding();
    const release = heldDeletes();
    expect((await t.delete('account', { method: 'password', proof: held.body.passwordProof }, held.cookie)).status).toBe(204);
    expect(await account(held.id)).toBeNull();
    expect(t.stores.inspect(held.incarnation).tables()).toEqual([]);
    expect(await pictures(held)).toBe(1);
    release();
    await t.settle();
    await gone(held);
  });

  it('frees the username and the signup place while the pictures are still being removed', async () => {
    const held = await holding();
    await t.env.db.prepare('UPDATE service SET signup_cap = (SELECT COUNT(*) FROM accounts)').run();
    const release = heldDeletes();
    expect((await t.delete('account', { method: 'password', proof: held.body.passwordProof }, held.cookie)).status).toBe(204);
    const again = signupBody(held.body.username);
    expect((await t.post('signup', again)).status).toBe(201);
    expect(await pictures(held)).toBe(1);
    release();
    await t.settle();
    await gone(held);
    expect(await account(again.accountId)).toMatchObject({ state: 'active' });
  });

  it('answers busy while the account restores', async () => {
    const seed = await seeded();
    await begin(seed);
    expect(await leave(t.env, seed.id, seed.incarnation, false)).toBe('busy');
    expect(await account(seed.id)).toMatchObject({ state: 'restoring' });
  });

  it('keeps the account row while a restart never reached the store, and finishes once one does', async () => {
    const held = await holding();
    const unreached: Services = {
      ...t.env,
      stores: {
        ...t.env.stores,
        getByName: (name) =>
          new Proxy(t.stores.getByName(name), {
            get: (stub, method) => (method === 'restart' ? () => Promise.reject(new Error('unreached')) : Reflect.get(stub, method)),
          }),
      },
    };
    expect(await leave(unreached, held.id, held.incarnation, false)).toBe('unavailable');
    expect(await account(held.id)).toMatchObject({ state: 'leaving' });
    expect(t.stores.inspect(held.incarnation).tables()).not.toEqual([]);
    expect(await pictures(held)).toBe(1);

    expect(await leave(t.env, held.id, held.incarnation, false)).toBe('left');
    await gone(held);
  });

  it('never takes the sole operator, by its own 탈퇴 or by the operator route, alone or beside other accounts', async () => {
    const refusedAll = async () => {
      expect(await leave(t.env, operator.id, operator.incarnation, false)).toBe('operator');
      expect(await leave(t.env, operator.id, operator.incarnation, true)).toBe('operator');
      const own = await t.delete('account', { method: 'password', proof: operator.body.passwordProof }, operator.cookie);
      expect([own.status, await own.json()]).toEqual([403, { error: 'sole-operator' }]);
      const route = await t.delete(`admin/accounts/${operator.id}`, undefined, operator.cookie);
      expect([route.status, await route.json()]).toEqual([403, { error: 'sole-operator' }]);
      expect(await account(operator.id)).toMatchObject({ state: 'active' });
      expect(await logged('delete-account')).toBe(0);
    };
    await refusedAll();
    const other = await t.signUp();
    await refusedAll();
    expect((await t.delete(`admin/accounts/${other.id}`, undefined, operator.cookie)).status).toBe(204);
    expect(await account(other.id)).toBeNull();
  });
});

describe('an operation id', () => {
  it('is not given again after its account is deleted, so a request left holding it names nothing', async () => {
    const old = await seeded();
    const id = await begin(old);
    expect(await cancelRestore(t.env, id)).toMatchObject({ phase: 'cancelled', verified: true });
    expect(await leave(t.env, old.id, old.incarnation, false)).toBe('left');

    const next = await seeded();
    const current = await begin(next);
    expect(current).toBeGreaterThan(id);
    expect(await cancelRestore(t.env, id)).toBeNull();
    expect(await account(next.id)).toMatchObject({ state: 'restoring', operation: current });
  });
});

describe('an account id used again', () => {
  it('leaves a replacement incarnation and its restore untouched when an old runner resumes its operation read', async () => {
    const old = await seeded();
    const id = await begin(old);
    const late = pausing((what) => what.startsWith('db SELECT id, incarnation, at,'), true);
    const running = runRestore(late.env, id);
    await late.reached;
    let replacement!: NonNullable<Awaited<ReturnType<typeof account>>>;
    let current!: number;
    try {
      await cancelRestore(t.env, id);
      expect(await leave(t.env, old.id, old.incarnation, false)).toBe('left');
      const cookie = sessionCookie(await t.post('signup', { ...signupBody(), accountId: old.id }));
      replacement = (await account(old.id))!;
      expect(replacement.incarnation).not.toBe(old.incarnation);
      await t.batch([{ id: B, kind: 'chat', parent: null, body: 'replacement', baseRev: null }], cookie);
      const begun = await beginRestore(t.env, old.id, await asked(old.id), { at: old.at });
      current = (begun as { begun: number }).begun;
      await expect(runRestore(pausedAt('fenced').env, current)).rejects.toThrow(Crash);
      await t.stores.getByName(replacement.incarnation).mark(replacement.incarnation, current);
    } finally {
      late.release();
    }
    expect(await running).toBeNull();
    expect(await account(old.id)).toEqual({ ...replacement, state: 'restoring', operation: current });
    expect(await operation(current)).toMatchObject({ phase: 'fenced', verified: 0, error: null });
    expect(t.stores.inspect(replacement.incarnation).exec('SELECT body FROM objects')).toEqual([{ body: 'replacement' }]);
    expect(mark(replacement.incarnation, current)).toEqual([{ value: 'marked' }]);
  });

  it('gets a new incarnation that sees nothing of the old one: no objects, pictures, usage or held files', async () => {
    const seed = await seeded();
    const bytes = new Uint8Array([7]);
    const file = sha256Hex(bytes);
    await t.put(`files/${file}`, bytes, seed.cookie);
    expect(await leave(t.env, seed.id, seed.incarnation, false)).toBe('left');

    const again = sessionCookie(await t.post('signup', { ...signupBody(), accountId: seed.id }));
    expect((await account(seed.id))!.incarnation).not.toBe(seed.incarnation);
    expect(await contents(again)).toEqual({});
    expect(await (await t.post('files/missing', { ids: [file] }, again)).json()).toEqual({ missing: [file], maxBytes: MAX_FILE_BYTES, room: null });
    expect(await (await t.get('session', again)).json()).toMatchObject({ session: { storage: { bytes: 0, fileBytes: 0 } } });
  });

  it("is safe from the old account's late runs: a deletion paused before it deletes the row, and a finalize", async () => {
    const old = await seeded();
    const finishing = await begin(old);
    await expect(runRestore(pausedAt('done').env, finishing)).rejects.toThrow(Crash);
    // The old account's deletion, paused once the store is emptied; another run of it finishes meanwhile.
    const late = pausing((what) => what === 'store destroy');
    const leaving = leave(late.env, old.id, old.incarnation, false);
    await late.reached;
    expect(await leave(t.env, old.id, old.incarnation, false)).toBe('left');

    const again = sessionCookie(await t.post('signup', { ...signupBody(), accountId: old.id }));
    await t.batch([{ id: B, kind: 'chat', parent: null, body: 'mine', baseRev: null }], again);
    late.release();
    expect(await leaving).toBe('left');
    expect(await runRestore(t.env, finishing)).toBeNull();
    const renewed = (await account(old.id))!;
    expect(renewed.state).toBe('active');
    expect(await contents(again)).toEqual({ [B]: 'mine' });
    expect(await t.stores.getByName(renewed.incarnation).status(renewed.incarnation)).toEqual({ state: 'active', timeline: renewed.timeline, operation: null });
  });
});

function pausedAt(phase: RestorePhase) {
  return watched(async (what) => {
    const reached = await t.env.db.prepare('SELECT 1 FROM restores WHERE phase = ? AND verified = 0').bind(phase).first();
    if (reached) throw new Crash(what);
  });
}
