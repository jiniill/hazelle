import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, renameSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { parentPort, workerData } from 'node:worker_threads';
import { createGzip } from 'node:zlib';
import { readNamed, type NamedRead } from '../backup/generation';
import { fsyncPath } from './durable';
import { openDatabase } from './service-db';
import type { SnapshotArchive, SnapshotJob } from './snapshot';
import { transaction } from './transaction';

type Job<K extends SnapshotJob['kind']> = Extract<SnapshotJob, { kind: K }>;

async function archive({ plain, gzip }: Job<'archive'>): Promise<SnapshotArchive> {
  const db = new DatabaseSync(plain);
  try {
    // Compact only the private copy; an online backup alone would retain the live database's free pages.
    db.exec('PRAGMA journal_mode = DELETE');
    db.exec('VACUUM');
    const [check] = db.prepare('PRAGMA quick_check').all();
    if (check?.quick_check !== 'ok') throw new Error(`Snapshot failed quick_check: ${check?.quick_check}`);
  } finally {
    db.close();
  }

  const expanded = statSync(plain).size;
  const hash = createHash('sha256');
  let bytes = 0;
  await pipeline(createReadStream(plain), createGzip(), async function* (chunks) {
    for await (const chunk of chunks as AsyncIterable<Buffer>) {
      hash.update(chunk);
      bytes += chunk.length;
      yield chunk;
    }
  }, createWriteStream(gzip));
  fsyncPath(gzip);
  return { bytes, expanded, sha256: hash.digest('hex') };
}

// Fsync the id list before rename/publication beside the gzip. A torn named list could hide a base-body deletion;
// list-disk failure must fail capture too.
function baseIds({ whole, temp, target }: Job<'base-ids'>): void {
  try {
    const db = new DatabaseSync(temp);
    try {
      db.prepare('ATTACH DATABASE ? AS whole').run(whole);
      db.exec('CREATE TABLE ids (id TEXT PRIMARY KEY); INSERT INTO ids SELECT id FROM whole.objects WHERE body IS NOT NULL');
    } finally {
      db.close();
    }
    fsyncPath(temp);
    renameSync(temp, target);
  } finally {
    rmSync(temp, { force: true });
  }
}

function delta({ live, plain, baseRev }: Job<'delta'>): void {
  const db = openDatabase(live);
  try {
    db.prepare('ATTACH DATABASE ? AS delta').run(plain);
    transaction(db, () => {
      // Delta correctness requires append-only rows with strictly increasing revs; purges clear body, never hard-delete.
      // Any future hard delete needs a delta-carried purge log first.
      db.exec(`CREATE TABLE delta.head AS SELECT * FROM main.head;
        CREATE TABLE delta.kv AS SELECT * FROM main.kv;
        CREATE TABLE delta.objects AS SELECT * FROM main.objects WHERE rev > ${baseRev};`);
    });
  } finally {
    db.close();
  }
}

function merge({ whole, delta: path, onlyIfDeletesHeld }: Job<'merge'>): boolean {
  const db = new DatabaseSync(whole);
  try {
    db.prepare('ATTACH DATABASE ? AS delta').run(path);
    if (onlyIfDeletesHeld && db.prepare('SELECT 1 FROM delta.objects d JOIN main.objects b ON b.id = d.id WHERE d.body IS NULL AND b.body IS NOT NULL LIMIT 1').get() === undefined) return false;
    transaction(db, () => {
      db.exec(`INSERT OR REPLACE INTO objects (id, kind, parent_id, rev, body, deleted_at) SELECT id, kind, parent_id, rev, body, deleted_at FROM delta.objects;
        DELETE FROM kv; INSERT INTO kv SELECT * FROM delta.kv;
        DELETE FROM head; INSERT INTO head SELECT * FROM delta.head;`);
    });
    return true;
  } finally {
    db.close();
  }
}

function named({ path, now, sources }: Job<'named'>): NamedRead {
  const read = readNamed(path, now);
  // Receiving 220k sources would hold the main thread 0.2 s, and only a disk bucket places them.
  return sources ? read : { named: read.named, sources: new Map() };
}

function run(job: SnapshotJob) {
  switch (job.kind) {
    case 'archive': return archive(job);
    case 'base-ids': return baseIds(job);
    case 'delta': return delta(job);
    case 'merge': return merge(job);
    case 'named': return named(job);
  }
}

parentPort!.postMessage(await run(workerData as SnapshotJob));
