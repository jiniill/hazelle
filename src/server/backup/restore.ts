import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import type { ExecutionContext } from 'hono';
import { BEFORE_ARMED, type RestorePhase } from '../../contracts/admin';
import { serviceReads } from '../account-store';
import { accountPath, accountRegistry, installSnapshot, materializeSnapshot } from '../db/account-db';
import { digest, fsyncPath } from '../db/durable';
import { migrate } from '../db/migrate';
import { openDatabase, serviceDb } from '../db/service-db';
import { fileKey, snapshotKey, type Bucket, type R2Bucket } from '../files/bucket';
import { diskBucket } from '../files/disk-bucket';
import { takeBackFiles } from '../files/claims';
import type { Services } from '../http';
import { cancelRestore, leaveAccount, runRestore } from '../lifecycle';
import { relayBudget, tokenBucket, uploadBudget, visitorLimits } from '../limits';
import { openPulse } from '../pulse';
import { streamRegistry } from '../stream-registry';
import { streamStore } from '../db/streams-db';
import { alerts } from '../alerts';
import { backups } from './backups';
import { DEPARTURES, readDepartures, writeDepartures } from './departures';
import { generationPictures, generationsDir, POOL, readManifest, type Manifest } from './generation';

// Restore one generation beside its files/ pool into empty data; verify hashes before writes (R2 pictures: sizes only).
// Install service before pictures so reconciliation can see their owners; never start the server mid-restore.
// Resolve pending operations through lifecycle, replay departures, revoke sessions and reset every account timeline
// (docs/research/docker-port-plan.md §10.2).

const HEADS = 16;

async function verify(generation: string, manifest: Manifest, files: Bucket, source: Bucket) {
  if (manifest.bucket === 'r2' && files.kind !== 'r2') throw new Error('restore: the generation’s pictures are in an R2 bucket; set HAZELLE_FILES_BUCKET=r2 and its HAZELLE_FILES_R2_* to that bucket');
  const check = async (path: string, expected: string) => {
    const actual = await digest(path).then(({ sha256 }) => sha256, () => 'missing');
    if (actual !== expected) throw new Error(`restore: ${path} is ${actual === 'missing' ? 'missing' : 'corrupt'}`);
  };
  await check(join(generation, manifest.service.path), manifest.service.sha256);
  for (const snapshot of manifest.snapshots) {
    const body = await source.get(snapshotKey(snapshot.incarnation, snapshot.id));
    const actual = body && await digest(body);
    if (!actual || actual.sha256 !== snapshot.sha256 || actual.bytes !== snapshot.bytes) throw new Error(`restore: ${snapshot.path} is ${actual ? 'corrupt' : 'missing'}`);
  }
  if (manifest.bucket === 'disk') for (const picture of manifest.pictures) await check(join(generation, '..', POOL, picture), picture);
}

// Every stored picture the service names is in the store at the size its row records, or the restore fails naming each
// one that is not. Sizes only: reading every object back to hash it is not done.
async function inStore(files: R2Bucket, service: string, manifest: Manifest) {
  const db = new DatabaseSync(service, { readOnly: true });
  let stored: { incarnation: string; id: string; size: number }[];
  try {
    stored = generationPictures(db, manifest.snapshots.map(({ id }) => id));
  } finally {
    db.close();
  }
  const wrong: string[] = [];
  for (let start = 0; start < stored.length; start += HEADS) {
    await Promise.all(
      stored.slice(start, start + HEADS).map(async ({ incarnation, id, size }) => {
        const found = await files.head(fileKey(incarnation, id));
        if (found !== size) wrong.push(`${fileKey(incarnation, id)}: ${found === null ? 'missing' : `${found} bytes, not ${size}`}`);
      }),
    );
  }
  if (wrong.length) throw new Error(`restore: ${wrong.length} of ${stored.length} pictures are not in the R2 bucket as the generation names them:\n${wrong.sort().join('\n')}`);
}

// accounts lists restored accounts; deleted includes completed deletions/departures.
// Missing departures must be reported. Revoke every captured session: later logouts/password changes were rolled back.
export type Restored = {
  accounts: { id: string; username: string }[];
  pictures: number;
  operations: { id: number; phase: RestorePhase }[];
  deleted: number;
  departures: 'replayed' | 'missing';
  sessions: number;
};

export type RestoreOptions = { fromStore?: boolean; withoutDepartures?: boolean };

export async function restoreGeneration(generation: string, dataDir: string, migrationsDir: string, files: Bucket, { fromStore = false, withoutDepartures = false }: RestoreOptions = {}): Promise<Restored> {
  const manifest = await readManifest(generation);
  // No `copied` needed: that marker is for freshness and the copier; a generation with its manifest and verified
  // hashes is a whole restore source wherever it lies.
  if (manifest === null) throw new Error(`restore: ${generation} has no manifest; it is not a complete generation`);
  if (manifest.version !== 2 && manifest.version !== 3 && manifest.version !== 4) throw new Error(`restore: manifest version ${manifest.version} is not one this build reads`);
  if (fromStore && (manifest.version !== 4 || manifest.snapshotStore.kind !== 'r2' || files.kind !== 'r2' || manifest.snapshotStore.bucket !== files.name)) throw new Error('restore: store source requires a v4 generation from this R2 bucket');
  const archives = fromStore ? files : diskBucket(generation);
  await mkdir(dataDir, { recursive: true });
  if ((await readdir(dataDir)).length) throw new Error(`restore: ${dataDir} is not empty`);
  await verify(generation, manifest, files, archives);
  const ledger = join(generation, '..', DEPARTURES);
  const departures = readDepartures(ledger);
  if (departures === null && !withoutDepartures) {
    throw new Error(`restore: ${ledger} is missing, so accounts that left after this generation cannot be deleted again; fetch it beside the generation, or pass --without-departures and review the restored accounts`);
  }

  const service = join(dataDir, 'service.sqlite');
  await pipeline(createReadStream(join(generation, manifest.service.path)), createGunzip(), createWriteStream(service, { flags: 'wx' }));
  fsyncPath(service);
  // verify refused an r2 generation into any other bucket. A failure leaves the directory empty, as it found it.
  if (manifest.bucket === 'r2' && files.kind === 'r2') {
    await inStore(files, service, manifest).catch(async (error: unknown) => {
      for (const suffix of ['', '-wal', '-shm']) await rm(join(dataDir, `service.sqlite${suffix}`), { force: true });
      throw error;
    });
  }
  const raw = openDatabase(service);
  migrate(raw, migrationsDir);
  const db = serviceDb(raw);
  const pictures = generationPictures(raw, manifest.snapshots.map(({ id }) => id));
  // The catalog names every snapshot the source had; only the generation's came along.
  await db.prepare('DELETE FROM snapshots WHERE id NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(manifest.snapshots.map(({ id }) => id))).run();
  if (archives.kind === 'disk') for (const snapshot of manifest.snapshots) {
    const key = snapshotKey(snapshot.incarnation, snapshot.id);
    await files.putFile(key, archives.path(key));
  }
  await mkdir(join(dataDir, 'accounts'), { recursive: true });
  // A version 2 manifest names a baseline for every account, and a fenced one has not changed since its checkpoint,
  // which is newer; version 3 names that checkpoint as the account's source itself (generation.ts readNamed).
  const fenced = new Map(manifest.version === 2 ? manifest.operations.flatMap(({ incarnation, phase, checkpoint }) => (BEFORE_ARMED.includes(phase) && checkpoint !== null ? [[incarnation, checkpoint]] : [])) : []);
  for (const { incarnation, baseline } of manifest.accounts) {
    const source = fenced.get(incarnation) ?? baseline;
    if (source === null) continue;
    await materializeSnapshot(files, db, incarnation, source, accountPath(dataDir, incarnation));
    fsyncPath(accountPath(dataDir, incarnation));
    await db.batch(takeBackFiles(db, incarnation, { snapshot: source }));
  }
  // Past its install already: the live file was the target when the generation was taken.
  for (const { id, incarnation, phase, target } of manifest.operations) if (phase === 'rewound') await installSnapshot(dataDir, db, incarnation, target!, id, files);
  if (manifest.bucket === 'disk') for (const { incarnation, id } of pictures) await files.put(fileKey(incarnation, id), await readFile(join(generation, '..', POOL, id)));
  for (const dir of ['', 'accounts']) fsyncPath(join(dataDir, dir));
  // Carried over, so this machine's copier never replaces the remote ledger with one that lacks them.
  if (departures !== null) writeDepartures(generationsDir(dataDir), departures);

  const outbound = () => Promise.reject(new Error('A restore calls no provider.'));
  const relay = relayBudget();
  const env: Services = {
    db,
    files,
    stores: accountRegistry(dataDir, db, serviceReads(db), Date.now, files),
    streams: streamRegistry(streamStore(':memory:'), outbound, relay),
    outbound,
    localProviders: new Set(),
    limits: { relay, calls: tokenBucket(1), botCalls: tokenBucket(1), visitors: visitorLimits(), uploads: uploadBudget() },
    backups: backups(dataDir, 0, alerts(null)),

    pulse: openPulse(db),
  };
  try {
    const operations: Restored['operations'] = [];
    for (const { id } of manifest.operations) {
      const { phase } = (await db.prepare('SELECT phase FROM restores WHERE id = ?').bind(id).first<{ phase: RestorePhase }>())!;
      const ended = BEFORE_ARMED.includes(phase) ? await cancelRestore(env, id) : await runRestore(env, id);
      if (ended === null || ended === 'too-late' || !ended.verified) throw new Error(`restore: operation ${id} did not end (${JSON.stringify(ended)})`);
      operations.push({ id, phase: ended.phase });
    }
    // An account that left after the generation was captured is in it as active; it is deleted again as it was then,
    // with no operator log row, since a 탈퇴 is kept out of that log (legal.ts).
    const { results: leaving } = await db
      .prepare("SELECT id, incarnation FROM accounts WHERE state = 'leaving' OR incarnation IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify((departures ?? []).map(({ incarnation }) => incarnation)))
      .all<{ id: string; incarnation: string }>();
    const after: Promise<unknown>[] = [];
    const ctx: Pick<ExecutionContext, 'waitUntil'> = { waitUntil: (work) => void after.push(work) };
    for (const { id, incarnation } of leaving) {
      const left = await leaveAccount(env, ctx, id, incarnation, false);
      if (left !== 'left') throw new Error(`restore: the deletion of ${id} did not finish (${left})`);
    }
    await Promise.all(after);
    const sessions = (await db.prepare('DELETE FROM sessions').run()).meta.changes;
    await db.prepare('UPDATE accounts SET timeline = lower(hex(randomblob(16)))').run();
    const { results: accounts } = await db.prepare('SELECT id, username FROM accounts ORDER BY username').all<{ id: string; username: string }>();
    const stored = (await db.prepare('SELECT COUNT(*) AS n FROM account_files WHERE stored = 1').first<number>('n'))!;
    return { accounts, pictures: stored, operations, deleted: leaving.length, departures: departures === null ? 'missing' : 'replayed', sessions };
  } finally {
    env.stores.close();
    raw.close();
  }
}
