import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, link, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountState, RestorePhase } from '../../contracts/admin';
import { ACCOUNT_SCHEMA_VERSION, CURRENT_BASELINE, RETENTION_MS } from '../db/account-db';
import { fsyncPath, makeDirs } from '../db/durable';
import { archiveSnapshot, snapshotJob, type SnapshotArchive } from '../db/snapshot';
import { fileKey, snapshotKey, type Bucket, type DiskBucket } from '../files/bucket';
import { entries } from '../files/disk-bucket';
import { DAY_MS, type Services } from '../http';
import { expireDepartures } from './departures';
import { dayStart, pass, PINNED, staleBaselines, takeBaselines } from './snapshots';

// backup/<id>/ gets service/snapshots, then manifest.json last (docs/research/docker-port-plan.md §10.2).
// Under the gate, hard-link/copy disk files so live deletion cannot remove them; pictures share backup/files/<sha256>.
// R2 files stay in their bucket until no generation references them (reconcile.ts). Off-site archive pooling precedes
// the copied marker; completeness requires both manifest and copied (src/server/db/README.md).

export const MANIFEST = 'manifest.json';
export const COPIED = 'copied';
export const POOL = 'files';
const GENERATION = /^(\d+)-[0-9a-f]{8}$/;

// bytes: the gzip on disk. expanded: what it gunzips to, measured on the plain file before it was gzipped (the gzip
// trailer holds that only modulo 4 GiB).
type Artifact = { path: string } & SnapshotArchive;
// Restore accounts from checkpoint when present, else baseline; null marks leaving accounts whose deletion restore must finish.
// Checkpoints hold fenced state: restore cancels pre-armed operations and finishes armed ones. TAKES_BASELINE prevents
// post-checkpoint baselines; completed rewinds start a new timeline. pictureBytes is restored per owning account.
// snapshots includes baselines, pinned snapshots and delta bases. materialized estimates expanded bytes (delta + base),
// excluding index growth; scripts/destroy.sh adds its drill margin. operations includes unfinished/unverified operations.
// bucket locates pictures (SHA-256 ids); snapshotStore locates archives, inside disk generations or in the named R2 bucket.
// R2 archives are pooled remotely under snapshots/<bucket>/<incarnation>/<id>.sqlite.gz.
// Write pictures/migrations last, after bucket: deploy/rclone-backup.sh parses this tail/version and pools disk pictures only.
export type Manifest = {
  version: 2 | 3 | 4;
  snapshotStore: { kind: 'disk' } | { kind: 'r2'; bucket: string };
  id: string;
  capturedAt: number;
  service: Artifact;
  migrations: string[];
  accountSchema: number;
  bucket: Bucket['kind'];
  accounts: { incarnation: string; state: AccountState; baseline: string | null; pictureBytes: number }[];
  snapshots: (Artifact & { id: string; incarnation: string; materialized: number })[];
  operations: { id: number; incarnation: string; phase: RestorePhase; verified: boolean; checkpoint: string | null; target: string | null }[];
  pictures: string[];
};

export const generationsDir = (dataDir: string) => join(dataDir, 'backup');

// Hard-link on one filesystem, otherwise sync a .tmp-* copy before renaming. Content-stable names let existing targets
// skip hashing; interrupted temps are collected by pool/generation removal. The caller must sync the directory.
async function place(source: string, target: string) {
  try {
    await link(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return;
    if (code !== 'EXDEV') throw error;
    await copyWhole(source, target);
  }
}

// A copy that appears under its name only whole: a cut-off one leaves a .tmp-* beside it. The caller syncs the directory.
export async function copyWhole(source: string, target: string) {
  const temp = join(dirname(target), `.tmp-${randomBytes(8).toString('hex')}`);
  await copyFile(source, temp);
  fsyncPath(temp);
  await rename(temp, target);
}

type Named = Omit<Manifest, 'version' | 'id' | 'capturedAt' | 'service' | 'accountSchema' | 'bucket' | 'snapshotStore'>;
export type NamedRead = { named: Named; sources: Map<string, string[]> };

export function generationPictures(db: DatabaseSync, snapshots: string[]): { incarnation: string; id: string; size: number }[] {
  // Generations from before migration 0010 have no released files; restore still reads those service snapshots.
  const releases = db.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'file_removals' AND type = 'table'").get();
  const held = 'SELECT incarnation, id, size FROM account_files WHERE stored = 1';
  const released = `SELECT incarnation, id, size FROM file_removals r WHERE EXISTS (
    SELECT 1 FROM snapshots s WHERE s.incarnation = r.incarnation AND s.taken_at <= r.released_at
      AND s.id IN (SELECT value FROM json_each(?)))`;
  return db.prepare(`${held}${releases ? ` UNION ALL ${released}` : ''} ORDER BY id, incarnation`).all(...(releases ? [JSON.stringify(snapshots)] : [])) as { incarnation: string; id: string; size: number }[];
}

// What the service snapshot names, read from the snapshot itself so the manifest and the service agree.
export function readNamed(path: string, now: number): NamedRead {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const all = <T>(sql: string, ...binds: (string | number)[]) => db.prepare(sql).all(...binds) as T[];
    const accounts = all<Omit<Manifest['accounts'][number], 'pictureBytes'>>(
      `SELECT incarnation, state,
         COALESCE((SELECT checkpoint FROM restores WHERE id = a.operation), (${CURRENT_BASELINE('id', 'a', '?1')})) AS baseline
       FROM accounts a ORDER BY incarnation`,
      now,
    );
    const unbacked = accounts.filter(({ state, baseline }) => state !== 'leaving' && baseline === null);
    if (unbacked.length) throw new Error(`generation: ${unbacked.length} accounts have no baseline`);
    const snapshots = all<Omit<Manifest['snapshots'][number], 'path'>>(
      `WITH named AS (SELECT id, base FROM snapshots s WHERE id IN (SELECT value FROM json_each(?1)) OR ${PINNED('s', '?2')})
       SELECT s.id, s.incarnation, s.bytes, s.expanded, s.sha256, s.expanded + COALESCE(b.expanded, 0) AS materialized
       FROM snapshots s LEFT JOIN snapshots b ON b.id = s.base
       WHERE s.id IN (SELECT id FROM named UNION SELECT base FROM named) ORDER BY s.incarnation, s.id`,
      JSON.stringify(accounts.map(({ baseline }) => baseline).filter((id) => id !== null)),
      now,
    );
    const operations = all<Omit<Manifest['operations'][number], 'verified'> & { verified: number }>(
      `SELECT id, incarnation, phase, verified, checkpoint, target FROM restores WHERE phase != 'done' OR verified = 0 ORDER BY id`,
    ).map((operation) => ({ ...operation, verified: Boolean(operation.verified) }));
    const sources = new Map<string, string[]>();
    const pictures = generationPictures(db, snapshots.map(({ id }) => id));
    const sizes = new Map<string, number>();
    for (const { incarnation, id, size } of pictures) {
      sizes.set(incarnation, (sizes.get(incarnation) ?? 0) + size);
      sources.set(id, [...(sources.get(id) ?? []), incarnation]);
    }
    const migrations = all<{ name: string }>('SELECT name FROM migrations ORDER BY rowid').map(({ name }) => name);
    return {
      named: {
        accounts: accounts.map((account) => ({ ...account, pictureBytes: sizes.get(account.incarnation) ?? 0 })),
        snapshots: snapshots.map((snapshot) => ({ ...snapshot, path: snapshotKey(snapshot.incarnation, snapshot.id) })),
        operations,
        pictures: [...sources.keys()],
        migrations,
      },
      sources,
    };
  } finally {
    db.close();
  }
}

// Holds the gate (exclusive) while it brings every account's baseline up to its last finished rewind (and one restoring
// before its checkpoint current as of today), snapshots the service, and links what that snapshot names; compresses and writes
// the manifest after. now: the job's time, which names the generation; clock: that time moved on by the job's run, so
// the baselines the job itself took are never ahead of it. gateMs: how long lifecycle operations waited on it.
export async function captureGeneration(
  env: Services,
  dataDir: string,
  now: number,
  clock: () => number,
  exclusive: <T>(work: () => Promise<T>) => Promise<{ value: T; gateMs: number }>,
): Promise<{ id: string; gateMs: number; manifest: Manifest }> {
  const id = `${now}-${randomBytes(4).toString('hex')}`;
  const root = join(generationsDir(dataDir), id);
  const pool = join(generationsDir(dataDir), POOL);
  makeDirs(pool);
  makeDirs(root);
  const plain = join(root, 'service.sqlite');
  const { value: named, gateMs } = await exclusive(async () => {
    // An older baseline would restore the account as it was before its last rewind.
    const { failed } = await takeBaselines(env, await staleBaselines(env, clock(), 0));
    if (failed.length) throw new Error(`generation: ${failed.length} accounts could not be brought up to their last rewind`);
    // A generation taken after a release can still install an older baseline or pinned target. Its R2 pictures must
    // outlive this generation, not merely the release that first queued them.
    await env.db.prepare(`UPDATE file_removals SET due_at = MAX(due_at, ?1) WHERE EXISTS (
      SELECT 1 FROM snapshots s WHERE s.incarnation = file_removals.incarnation AND s.taken_at <= file_removals.released_at)`)
      .bind(clock() + RETENTION_MS).run();
    await env.db.snapshot(plain);
    const copy = new DatabaseSync(plain);
    try {
      // A backup outlives the day: no daily visitor key or hash may enter its retained copy, even in free pages.
      copy.exec('PRAGMA secure_delete = ON; DELETE FROM visit_hashes; DELETE FROM visit_keys');
    } finally {
      copy.close();
    }
    expireDepartures(generationsDir(dataDir), clock());
    const files = env.files;
    const { named, sources } = await snapshotJob<NamedRead>({ kind: 'named', path: plain, now: clock(), sources: files.kind === 'disk' });
    const dirs = new Set<string>([pool]);
    if (files.kind === 'disk') for (const snapshot of named.snapshots) {
      const target = join(root, snapshot.path);
      makeDirs(dirname(target));
      await place(files.path(snapshotKey(snapshot.incarnation, snapshot.id)), target);
      dirs.add(dirname(target));
    }
    if (files.kind === 'disk') {
      for (const [picture, holders] of sources) {
        await placePicture(files, join(pool, picture), picture, holders);
        await pass();
      }
    }
    for (const dir of dirs) fsyncPath(dir);
    return named;
  });
  const compressed = `${plain}.gz`;
  const artifact = await archiveSnapshot(plain, compressed);
  await rm(plain);
  const manifest: Manifest = {
    version: 4,
    id,
    capturedAt: now,
    service: { path: 'service.sqlite.gz', ...artifact },
    accountSchema: ACCOUNT_SCHEMA_VERSION,
    bucket: env.files.kind,
    snapshotStore: env.files.kind === 'disk' ? { kind: 'disk' } : { kind: 'r2', bucket: env.files.name },
    ...named,
  };
  const temp = join(root, `.tmp-${MANIFEST}`);
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(JSON.stringify(manifest));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, join(root, MANIFEST));
  fsyncPath(root);
  return { id, gateMs, manifest };
}

// Any account holding the picture is its source: the id is its content.
async function placePicture(files: DiskBucket, target: string, picture: string, holders: string[]) {
  for (const incarnation of holders) {
    try {
      await place(files.path(fileKey(incarnation, picture)), target);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`generation: picture ${picture} is stored but on no disk`);
}

// Version 1 was written before the R2 bucket, so its pictures are in the pool:
// 2 names whole snapshots only; 3 may name deltas beside their bases, and a build before it refuses one, since it would
// install a delta file as the account. Both keep archives in the generation even when pictures are in R2.
// Version 4 records the archive store; its bucket name also reaches the copier, which has no app-store environment.
export async function readManifest(root: string): Promise<Manifest | null> {
  try {
    const manifest = JSON.parse(await readFile(join(root, MANIFEST), 'utf8')) as Manifest | (Omit<Manifest, 'version' | 'bucket' | 'snapshotStore'> & { version: 1 });
    if (manifest.version === 1) return { ...manifest, version: 2, bucket: 'disk', snapshotStore: { kind: 'disk' } };
    return manifest.version === 2 || manifest.version === 3 ? { ...manifest, snapshotStore: { kind: 'disk' } } : manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export const listGenerations = (dataDir: string) => generationsIn(generationsDir(dataDir));

// root: backup/ or a folder its generations are copied to (folder.ts), which share one layout.
export async function generationsIn(root: string): Promise<{ id: string; capturedAt: number }[]> {
  return (await entries(root)).flatMap((name) => {
    const at = GENERATION.exec(name)?.[1];
    return at === undefined ? [] : [{ id: name, capturedAt: Number(at) }];
  });
}

// Every R2 archive a local version 4 generation names, with the time the newest of those generations expires
// (expireGenerations). A --snapshots-from-store restore reads these from the store, so none may go before then.
export async function namedArchives(dataDir: string): Promise<Map<string, number>> {
  const named = new Map<string, number>();
  for (const { id, capturedAt } of await listGenerations(dataDir)) {
    const manifest = await readManifest(join(generationsDir(dataDir), id));
    if (manifest?.version !== 4 || manifest.snapshotStore.kind !== 'r2') continue;
    for (const { path } of manifest.snapshots) named.set(path, Math.max(named.get(path) ?? 0, capturedAt + RETENTION_MS));
  }
  return named;
}

// Expire at RETENTION_MS; incomplete generations after one day. Within retention keep the newest two for rollback
// (user, 2026-10-12), each UTC day's newest and anything not copied off-site. Then remove pool files no disk generation names.
// Run without concurrent capture. Keep folder.ts and deploy/rclone-backup.sh prune in sync with this retention rule.
export const expireGenerations = (dataDir: string, now: number) => thinGenerations(generationsDir(dataDir), now);

export async function thinGenerations(dir: string, now: number): Promise<{ removed: number; pictures: number }> {
  let removed = 0;
  let whole = 0;
  const days = new Set<number>();
  const kept = new Set<string>();
  for (const { id, capturedAt } of (await generationsIn(dir)).toSorted((a, b) => b.capturedAt - a.capturedAt)) {
    const root = join(dir, id);
    const manifest = await readManifest(root);
    let keep: boolean;
    if (manifest === null) keep = capturedAt > now - DAY_MS;
    else if (capturedAt <= now - RETENTION_MS) keep = false;
    else {
      const day = dayStart(capturedAt);
      keep = whole++ < 2 || !days.has(day) || !existsSync(join(root, COPIED));
      days.add(day);
    }
    if (!keep) {
      await rm(root, { recursive: true, force: true });
      removed++;
    } else if (manifest?.bucket === 'disk') for (const picture of manifest.pictures) kept.add(picture);
    await pass();
  }
  let pictures = 0;
  const pool = join(dir, POOL);
  for (const name of await readdir(pool).catch(() => [])) {
    if (kept.has(name)) continue;
    await rm(join(pool, name), { force: true });
    pictures++;
  }
  return { removed, pictures };
}
