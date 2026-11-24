import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from './db/migrate';
import { serviceDb } from './db/service-db';
import { diskBucket } from './files/disk-bucket';
import { fakeS3 } from './files/fake-s3';
import { r2Bucket } from './files/r2-bucket';
import { reconcile } from './reconcile';

const NOW = 1_800_000_000_000;
const OLD = (NOW - 2 * 60 * 60 * 1000) / 1000;
const FRESH = (NOW - 60 * 1000) / 1000;
const LIVE = 'a'.repeat(32);
const GONE = 'b'.repeat(32);
const NEW = 'c'.repeat(32);
const ID = 'd'.repeat(64);

let dir = '';
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup() {
  dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
  const raw = new DatabaseSync(':memory:');
  migrate(raw, 'migrations');
  raw.prepare("INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) VALUES ('u', 'jin', 'h', 1, ?, 't')").run(LIVE);
  raw.prepare("INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256) VALUES ('1-000000000000', ?, 'k', 1, 0, 1, 1, 's')").run(LIVE);
  return serviceDb(raw);
}

// Files first, then their directories, so a directory's own mtime is the one set here.
function place(entries: [string, number][]) {
  for (const [path] of entries) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    if (!path.endsWith('/')) writeFileSync(join(dir, path), 'x');
  }
  for (const [path, at] of [...entries].sort(([a], [b]) => b.length - a.length)) utimesSync(join(dir, path), at, at);
}

describe('reconcile', () => {
  it('keeps a removal marked until its only remover finishes, even when another hourly run arrives', async () => {
    const db = setup();
    place([[`files/${LIVE}/${ID}`, OLD]]);
    await db.prepare('DELETE FROM snapshots').run();
    await db.prepare('INSERT INTO file_removals (incarnation, id, size, created_at, released_at, due_at) VALUES (?, ?, 1, 0, 1, 2)').bind(LIVE, ID).run();
    const files = diskBucket(dir);
    let reached!: () => void;
    const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
    let finish!: () => void;
    const finishPromise = new Promise<void>((resolve) => { finish = resolve; });
    let deletes = 0;
    const slow = { ...files, delete: async (key: string) => {
      deletes++;
      reached();
      await finishPromise;
      await files.delete(key);
    } };
    const first = reconcile(dir, db, slow, NOW);
    await reachedPromise;
    const second = reconcile(dir, db, slow, NOW + 3_600_000);
    expect(await db.prepare('SELECT removing FROM file_removals').first('removing')).toBe(1);
    finish();
    expect(await first).toEqual({ removed: [`files/${LIVE}/${ID}`] });
    expect(await second).toEqual(await first);
    expect(deletes).toBe(1);
  });

  it('removes a released picture once it is due and no snapshot of its account predates its release', async () => {
    const db = setup();
    const DAY = 24 * 60 * 60 * 1000;
    const LATER = 'e'.repeat(64);
    place([[`files/${LIVE}/${ID}`, OLD], [`files/${LIVE}/${LATER}`, OLD]]);
    const released = NOW - 8 * DAY;
    await db
      .prepare('INSERT INTO file_removals (incarnation, id, size, created_at, released_at, due_at) VALUES (?1, ?2, 1, 0, ?3, ?4), (?1, ?5, 1, 0, ?3, ?6)')
      .bind(LIVE, ID, released, NOW - DAY, LATER, NOW + DAY)
      .run();
    const files = diskBucket(dir);
    expect(await reconcile(dir, db, files, NOW)).toEqual({ removed: [] });
    await db.prepare('UPDATE snapshots SET taken_at = ? WHERE incarnation = ?').bind(released + 1, LIVE).run();
    expect(await reconcile(dir, db, files, NOW)).toEqual({ removed: [`files/${LIVE}/${ID}`] });
    expect([existsSync(join(dir, `files/${LIVE}/${ID}`)), existsSync(join(dir, `files/${LIVE}/${LATER}`))]).toEqual([false, true]);
    expect((await db.prepare('SELECT id FROM file_removals').all()).results).toEqual([{ id: LATER }]);
  });

  it('lets other requests in between the lookups of a long sweep', async () => {
    const db = setup();
    const ids = Array.from({ length: 300 }, (_, index) => `2-${index}`);
    for (const id of ids) await db.prepare("INSERT INTO snapshots (id, incarnation, kind, taken_at, rev, bytes, expanded, sha256) VALUES (?, ?, 'k', 1, 0, 1, 1, 's')").bind(id, LIVE).run();
    const files = { ...diskBucket(dir), archives: async () => ids.map((id) => ({ key: `snapshots/${LIVE}/${id}.sqlite.gz`, modified: OLD * 1000 })) };
    const prepare = db.prepare.bind(db);
    let looked = 0;
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (sql.startsWith('SELECT 1 FROM snapshots')) looked++;
      return prepare(sql);
    });
    const seen = new Set<number>();
    let watching = true;
    const watch = () => {
      seen.add(looked);
      if (watching) setImmediate(watch);
    };
    watch();
    await reconcile(dir, db, files, NOW);
    watching = false;
    expect(looked).toBe(ids.length);
    expect([...seen].some((count) => count > 0 && count < ids.length)).toBe(true);
  });

  it('answers nothing on a fresh install', async () => {
    expect(await reconcile(join(tmpdir(), 'hazelle-none'), setup(), diskBucket(join(tmpdir(), 'hazelle-none')), NOW)).toEqual({ removed: [] });
  });

  it("removes an orphan's pictures at any age and an old orphan's database, keeps a fresh orphan's database and a live account even when old", async () => {
    const db = setup();
    place([
      [`files/${LIVE}/${ID}`, OLD],
      [`files/${LIVE}/.tmp-1`, OLD],
      [`files/${LIVE}/.tmp-2`, FRESH],
      [`files/${LIVE}/`, OLD],
      [`files/${GONE}/${ID}`, OLD],
      [`files/${GONE}/`, OLD],
      [`files/${NEW}/${ID}`, FRESH],
      [`files/${NEW}/`, FRESH],
      [`accounts/${LIVE}.sqlite`, OLD],
      [`accounts/${LIVE}.sqlite-wal`, OLD],
      [`accounts/${GONE}.sqlite`, OLD],
      [`accounts/${GONE}.sqlite-wal`, OLD],
      [`accounts/${NEW}.sqlite`, OLD],
      [`accounts/${NEW}.sqlite-wal`, FRESH],
      [`accounts/${LIVE}.install-x.sqlite`, OLD],
      [`accounts/${NEW}.install-y.sqlite`, FRESH],
    ]);
    const { removed } = await reconcile(dir, db, diskBucket(dir), NOW);
    expect(removed.sort()).toEqual(
      [`files/${LIVE}/.tmp-1`, `files/${GONE}`, `files/${NEW}`, `accounts/${GONE}.sqlite`, `accounts/${GONE}.sqlite-wal`, `accounts/${LIVE}.install-x.sqlite`].sort(),
    );
  });

  it('removes an old uncatalogued snapshot and its emptied directory, and keeps a catalogued or fresh one', async () => {
    const db = setup();
    place([
      [`snapshots/${LIVE}/1-000000000000.sqlite.gz`, OLD],
      [`snapshots/${LIVE}/1-000000000001.sqlite.gz`, OLD],
      [`snapshots/${LIVE}/1-000000000002.sqlite.gz`, FRESH],
      [`snapshots/${LIVE}/`, OLD],
      [`snapshots/${GONE}/1-000000000001.sqlite.gz`, OLD],
      [`snapshots/${GONE}/`, OLD],
    ]);
    const { removed } = await reconcile(dir, db, diskBucket(dir), NOW);
    expect(removed.sort()).toEqual([`snapshots/${GONE}`, `snapshots/${GONE}/1-000000000001.sqlite.gz`, `snapshots/${LIVE}/1-000000000001.sqlite.gz`].sort());
  });

  it('removes an uncatalogued R2 archive no local generation names once it has settled, and leaves one that may be a capture in flight', async () => {
    const db = setup();
    const s3 = await fakeS3();
    try {
      const key = `snapshots/${GONE}/1-000000000001.sqlite.gz`;
      s3.objects.set(key, new Uint8Array([1]));
      const now = Date.now();
      await reconcile(dir, db, r2Bucket(s3.config), now);
      expect(s3.objects.has(key)).toBe(true);
      expect((await db.prepare('SELECT key FROM snapshot_removals').all()).results).toEqual([]);
      expect((await reconcile(dir, db, r2Bucket(s3.config), now + 2 * 60 * 60 * 1000)).removed).toEqual([key]);
      expect(s3.objects.has(key)).toBe(false);
    } finally {
      await s3.close();
    }
  });
});
