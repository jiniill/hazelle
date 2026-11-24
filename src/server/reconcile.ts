import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { namedArchives } from './backup/generation';
import { pass } from './backup/snapshots';
import { BASE_IDS_DIR, RETENTION_MS } from './db/account-db';
import type { Db } from './db/service-db';
import { fileKey, filePrefix, type Bucket } from './files/bucket';
import { entries, mtime } from './files/disk-bucket';

// The hourly sweep of what a crash or a late request left behind: the picture store, the account databases and the
// snapshots and their id lists; and the trim of the R2 store's copy on disk (files/cached-r2-bucket.ts).

// Younger than this, an entry may belong to a signup, an upload or a snapshot still being written.
const SETTLE_MS = 60 * 60 * 1000;
const ACCOUNT_DB = /^([0-9a-f]{32})\.sqlite(?:-wal|-shm)?$/;
const BASE_IDS = /^([0-9a-f]{32})-(.+)\.sqlite$/;

// A deleted account's pictures. On disk they go at once: a backup generation holds its own copies in its pool. In R2 a
// generation names them where they are, so they go once every generation that could name them has expired.
export async function removePictures(files: Bucket, db: Db, incarnation: string, now: number): Promise<void> {
  if (files.kind === 'disk') return files.deletePrefix(filePrefix(incarnation));
  await db.prepare('INSERT INTO picture_removals (incarnation, due_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(incarnation, now + RETENTION_MS).run();
}

const running = new WeakMap<Db, Promise<{ removed: string[] }>>();

export function reconcile(dataDir: string, db: Db, files: Bucket, now = Date.now()): Promise<{ removed: string[] }> {
  const previous = running.get(db);
  if (previous) return previous;
  // A second remover must never finish a row and admit a PUT while the first still holds its file key.
  const run = reconcileOnce(dataDir, db, files, now).finally(() => running.delete(db));
  running.set(db, run);
  return run;
}

async function reconcileOnce(dataDir: string, db: Db, files: Bucket, now: number): Promise<{ removed: string[] }> {
  const settled = now - SETTLE_MS;
  const removed: string[] = [];
  const remove = async (relative: string) => {
    await rm(join(dataDir, relative), { recursive: true, force: true });
    removed.push(relative);
  };
  // The service database answers inside the call, so a loop of lookups alone holds every request until its last one.
  let looked = 0;
  const known = async (sql: string, ...values: string[]) => {
    if (++looked % 100 === 0) await pass();
    return (await db.prepare(sql).bind(...values).first()) !== null;
  };
  const account = (incarnation: string) => known('SELECT 1 FROM accounts WHERE incarnation = ?', incarnation);

  // At any age: only a reservation, which needs the account's row, writes under a prefix, so what lands there once the
  // row is gone is an upload that outlived its account.
  for (const prefix of await files.prefixes()) {
    const incarnation = prefix.slice('files/'.length, -1);
    if (await account(incarnation)) continue;
    await removePictures(files, db, incarnation, now);
    if (files.kind === 'disk') removed.push(`files/${incarnation}`);
  }
  if (files.kind === 'r2') removed.push(...(await files.trim(now)));
  const { results: due } = await db.prepare('SELECT incarnation FROM picture_removals WHERE due_at <= ?').bind(now).all<{ incarnation: string }>();
  for (const { incarnation } of due) {
    await files.deletePrefix(filePrefix(incarnation));
    await db.prepare('DELETE FROM picture_removals WHERE incarnation = ?').bind(incarnation).run();
    removed.push(`files/${incarnation}`);
  }
  // Released pictures (files.ts release) past every generation and snapshot that could name them. Marked first, in the
  // one statement that picks them, so an upload of one waits instead of storing bytes about to go; a run cut short
  // leaves its marks for the next to finish.
  const { results: released } = await db
    .prepare(
      `UPDATE file_removals SET removing = 1
       WHERE removing = 1 OR (due_at <= ?1 AND NOT EXISTS (SELECT 1 FROM snapshots s WHERE s.incarnation = file_removals.incarnation AND s.taken_at <= file_removals.released_at))
       RETURNING incarnation, id`,
    )
    .bind(now)
    .all<{ incarnation: string; id: string }>();
  for (const { incarnation, id } of released) {
    await files.delete(fileKey(incarnation, id));
    await db.prepare('DELETE FROM file_removals WHERE incarnation = ? AND id = ?').bind(incarnation, id).run();
    removed.push(fileKey(incarnation, id));
  }

  // A database and its -wal and -shm go together, and only when all three have settled.
  const databases = new Map<string, { names: string[]; newest: number }>();
  for (const name of await entries(join(dataDir, 'accounts'))) {
    const at = await mtime(join(dataDir, 'accounts', name));
    const incarnation = ACCOUNT_DB.exec(name)?.[1];
    if (incarnation === undefined) {
      if (at < settled) await remove(`accounts/${name}`);
      continue;
    }
    const group = databases.get(incarnation) ?? { names: [], newest: -Infinity };
    group.names.push(name);
    group.newest = Math.max(group.newest, at);
    databases.set(incarnation, group);
  }
  for (const [incarnation, { names, newest }] of databases) {
    if (newest < settled && !(await account(incarnation))) for (const name of names) await remove(`accounts/${name}`);
  }

  const catalogued = (incarnation: string, id: string) => known('SELECT 1 FROM snapshots WHERE incarnation = ? AND id = ?', incarnation, id);
  // Written before its snapshot's row, so one younger than SETTLE_MS may belong to a capture still publishing.
  for (const name of await entries(join(dataDir, BASE_IDS_DIR))) {
    if ((await mtime(join(dataDir, BASE_IDS_DIR, name))) >= settled) continue;
    const [, incarnation, id] = BASE_IDS.exec(name) ?? [];
    if (incarnation === undefined || !(await catalogued(incarnation, id!))) await remove(`${BASE_IDS_DIR}/${name}`);
  }

  const archived = (key: string) => catalogued(key.split('/')[1]!, key.split('/')[2]!.slice(0, -'.sqlite.gz'.length));
  const named = files.kind === 'r2' ? await namedArchives(dataDir) : new Map<string, number>();
  for (const { key, modified } of await files.archives()) {
    if (await archived(key)) {
      await db.prepare('DELETE FROM snapshot_removals WHERE key = ?').bind(key).run();
      continue;
    }
    // Unsettled, an uncatalogued archive may be a capture whose row is not written yet.
    if (modified >= settled) continue;
    if (files.kind === 'r2') {
      await db.prepare('INSERT INTO snapshot_removals (key, due_at) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(key, named.get(key) ?? now).run();
    } else {
      await files.delete(key);
      removed.push(key);
    }
  }
  const { results: archives } = await db.prepare('SELECT key FROM snapshot_removals WHERE due_at <= ?').bind(now).all<{ key: string }>();
  for (const { key } of archives) {
    // Expiry of generations runs daily and can fail; a still-present local generation remains a rollback source.
    if (named.has(key)) continue;
    if (!(await archived(key))) {
      await files.delete(key);
      removed.push(key);
    }
    await db.prepare('DELETE FROM snapshot_removals WHERE key = ?').bind(key).run();
  }
  if (files.kind === 'disk') removed.push(...(await files.sweep(settled)));
  return { removed };
}
