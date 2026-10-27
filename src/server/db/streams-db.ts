import { openDatabase } from './service-db';
import { transaction } from './transaction';
import type { BoxStorage } from '../stream-box';

// Reply stream pages and their alarms, in $HAZELLE_DATA/streams.sqlite. A stream's alarm row is its reservation.
const VERSION = 1;

export type StreamStore = {
  storage(stream: string): BoxStorage;
  due(now: number): string[];
  remove(stream: string): void;
  close(): void;
};

export function streamStore(path: string): StreamStore {
  // Use NORMAL here: per-page fsync at 100 streams stalls every request. Power loss may drop only the newest WAL
  // suffix, alarms and pages together, never orphan pages without their reservation.
  const db = openDatabase(path, 'NORMAL');
  try {
    transaction(db, () => {
      db.exec('CREATE TABLE IF NOT EXISTS meta (version INTEGER NOT NULL)');
      const row = db.prepare('SELECT version FROM meta').get() as { version: number } | undefined;
      if (row && row.version > VERSION) throw new Error(`${path} is at version ${row.version}; this build knows ${VERSION} and never downgrades`);
      db.exec(`CREATE TABLE IF NOT EXISTS pages (stream TEXT NOT NULL, key TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY (stream, key));
        CREATE TABLE IF NOT EXISTS alarms (stream TEXT PRIMARY KEY, at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS alarms_at ON alarms (at)`);
      if (!row) db.prepare('INSERT INTO meta (version) VALUES (?)').run(VERSION);
    });
  } catch (error) {
    db.close();
    throw error;
  }

  const reserve = db.prepare('INSERT INTO alarms (stream, at) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const insert = db.prepare('INSERT INTO pages (stream, key, value) VALUES (?, ?, ?)');
  const get = db.prepare('SELECT value FROM pages WHERE stream = ? AND key = ?');
  const list = db.prepare('SELECT key, value FROM pages WHERE stream = ? AND key >= ? AND key < ? ORDER BY key LIMIT ?');
  const due = db.prepare('SELECT stream FROM alarms WHERE at <= ?');
  const removePages = db.prepare('DELETE FROM pages WHERE stream = ?');
  const removeAlarm = db.prepare('DELETE FROM alarms WHERE stream = ?');

  return {
    storage: (stream) => ({
      reserve: async (hello, expiresAt) =>
        transaction(db, () => {
          if (!reserve.run(stream, expiresAt).changes) return false;
          insert.run(stream, hello.key, hello.value);
          return true;
        }),
      get: async (key) => (get.get(stream, key) as { value: Uint8Array } | undefined)?.value,
      put: async (key, value) => void insert.run(stream, key, value),
      list: async ({ start, end, limit }) =>
        new Map((list.all(stream, start, end, limit) as { key: string; value: Uint8Array }[]).map(({ key, value }) => [key, value])),
    }),
    due: (now) => (due.all(now) as { stream: string }[]).map(({ stream }) => stream),
    remove: (stream) =>
      transaction(db, () => {
        removePages.run(stream);
        removeAlarm.run(stream);
      }),
    close: () => db.close(),
  };
}
