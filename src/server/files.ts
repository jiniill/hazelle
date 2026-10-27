import { Hono, type Context } from 'hono';
import { CLAIM_SETTLE_MS, FILE_ID, MAX_FILE_BYTES, MAX_FILE_IDS } from '../contracts/files';
import { ACCOUNT_USAGE_HEADERS } from '../contracts/http';
import { CAP } from './caps';
import { RETENTION_MS } from './db/account-db';
import type { Db, SqlValue, Statement } from './db/service-db';
import { fileKey } from './files/bucket';
import { takeBackFiles } from './files/claims';
import { fail, hex, readObject, refused, RETRY_SECONDS, type AppEnv } from './http';
import { canWrite, requireSession } from './session';

// File copies are incarnation-scoped, never shared between accounts. Live accounts' files are removed only by sweeps,
// after all referencing backups/rewinds expire (migration 0010). Uploads outliving deletion match no account row;
// reconcile.ts removes their orphaned bytes hourly.
export const files = new Hono<AppEnv>();

files.use(requireSession);

// Advertise size/space limits before uploads: worker size refusals look like dropped connections, and PUT reads before
// checking account capacity. Blocked ids count as missing so uploads fail explicitly instead of creating unreadable refs.
files.post('/missing', async (c) => {
  const input = await readObject(c);
  const ids = input?.ids;
  if (!Array.isArray(ids) || ids.length > MAX_FILE_IDS || !ids.every((id) => typeof id === 'string' && FILE_ID.test(id))) return fail(c, 400, 'bad-input');
  const { incarnation } = c.get('account');
  await c.env.db.prepare('UPDATE account_files SET claimed_at = ?3 WHERE incarnation = ?1 AND id IN (SELECT value FROM json_each(?2))').bind(incarnation, JSON.stringify(ids), Date.now()).run();
  const { results } = await c.env.db.prepare(
    `SELECT asked.value AS id FROM json_each(?2) AS asked
     WHERE NOT EXISTS (SELECT 1 FROM account_files WHERE incarnation = ?1 AND id = asked.value AND stored = 1) OR value IN (SELECT id FROM file_blocks)`,
  )
    .bind(incarnation, JSON.stringify(ids))
    .all<{ id: string }>();
  const { fileBytes, cap } = (await c.env.db.prepare(`SELECT file_bytes AS fileBytes, ${CAP.fileBytes} AS cap FROM accounts WHERE incarnation = ?1`).bind(incarnation).first<{ fileBytes: number; cap: number | null }>())!;
  const room = cap === null ? null : Math.max(0, cap - fileBytes);
  return c.json({ missing: results.map(({ id }) => id), maxBytes: MAX_FILE_BYTES, room });
});

// Content hashes make cross-account blocks and immutable GET caching valid.
// Reserve and charge before writing bytes, then finalize: crashes preserve caps; retries reuse the reservation.
files.put('/:id', canWrite, async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  // The body is read before any refusal: one answered while it is still being sent reaches the browser as a dropped
  // connection, which the client would wait out instead of taking the answer. A body refused for want of room is
  // read and dropped, never held. Its size is Content-Length: worker.ts refuses a chunked body before the route runs.
  const size = Number(c.req.header('content-length') ?? 0);
  const { uploads } = c.env.limits;
  if (!(await uploads.take(size))) {
    await c.req.raw.body?.pipeTo(new WritableStream());
    return fail(c, 503, 'busy', { retryAfter: RETRY_SECONDS });
  }
  try {
    return await publish(c, id);
  } finally {
    uploads.give(size);
  }
});

// What the session answers every request of a deleted or leaving account (session.ts currentAccount).
const outlived = (c: Context<AppEnv>) => fail(c, 401, 'no-session');
const ALIVE = "EXISTS (SELECT 1 FROM accounts WHERE incarnation = ?1 AND state != 'leaving')";

async function publish(c: Context<AppEnv>, id: string) {
  const db = c.env.db;
  const { incarnation } = c.get('account');
  const [blocked, body] = await Promise.all([
    db
      .prepare('SELECT EXISTS (SELECT 1 FROM file_blocks WHERE id = ?) AS blocked')
      .bind(id)
      .first<number>('blocked'),
    c.req.arrayBuffer(),
  ]);
  if (blocked) return fail(c, 403, 'file-blocked');
  // Keep hashing off-thread: concurrent 25 MiB uploads would block other requests with synchronous sha256Hex.
  if (hex(new Uint8Array(await crypto.subtle.digest('SHA-256', body))) !== id) return fail(c, 400, 'bad-input');
  // Read once the body is in, not beside it: the account may have begun leaving or be gone since the session check.
  if (!(await db.prepare(`SELECT ${ALIVE} AS alive`).bind(incarnation).first<number>('alive'))) return outlived(c);
  if (await db.prepare('UPDATE account_files SET claimed_at = ?3 WHERE incarnation = ?1 AND id = ?2 AND stored = 1 RETURNING id').bind(incarnation, id, Date.now()).first()) return c.body(null, 204);
  // A released copy is taken back unless its bytes are being deleted, which the reservation then waits out.
  const [, , , reservation] = await db.batch<{ reserved: number; stored: number; alive: number; removing: number }>([
    db
      .prepare(
        `INSERT INTO account_files (incarnation, id, size, stored, created_at, claimed_at)
         SELECT incarnation, ?2, ?3, EXISTS (SELECT 1 FROM file_removals WHERE incarnation = ?1 AND id = ?2), ?4, ?4
         FROM accounts WHERE incarnation = ?1 AND COALESCE(file_bytes + ?3 <= ${CAP.fileBytes}, 1)
           AND NOT EXISTS (SELECT 1 FROM file_removals WHERE incarnation = ?1 AND id = ?2 AND removing = 1)
         ON CONFLICT DO NOTHING`,
      )
      .bind(incarnation, id, body.byteLength, Date.now()),
    // The batch is one transaction: only an actually inserted reservation charges bytes. Existing reservations
    // remain retryable even after the cap is lowered. Deletion removes both the account's counter and its file rows.
    db.prepare('UPDATE accounts SET file_bytes = file_bytes + ?2 WHERE incarnation = ?1 AND changes() = 1').bind(incarnation, body.byteLength),
    db.prepare('DELETE FROM file_removals WHERE incarnation = ?1 AND id = ?2 AND EXISTS (SELECT 1 FROM account_files WHERE incarnation = ?1 AND id = ?2)').bind(incarnation, id),
    db
      .prepare(`SELECT EXISTS (SELECT 1 FROM account_files WHERE incarnation = ?1 AND id = ?2) AS reserved,
        (SELECT stored FROM account_files WHERE incarnation = ?1 AND id = ?2) AS stored,
        ${ALIVE} AS alive, EXISTS (SELECT 1 FROM file_removals WHERE incarnation = ?1 AND id = ?2 AND removing = 1) AS removing`)
      .bind(incarnation, id),
  ]);
  const { reserved, stored, alive, removing } = reservation!.results[0]!;
  if (!alive) return outlived(c);
  if (removing) return fail(c, 503, 'busy', { retryAfter: RETRY_SECONDS });
  if (!reserved) return fail(c, 413, 'files-full');
  // A reclaimed copy is already durable. Never demote it to a reservation a generation would omit.
  if (!stored) await c.env.files.put(fileKey(incarnation, id), body);
  const fileBytes = await db
    .prepare(`UPDATE account_files SET stored = 1 WHERE incarnation = ?1 AND id = ?2 RETURNING (SELECT file_bytes FROM accounts WHERE incarnation = ?1) AS fileBytes`)
    .bind(incarnation, id)
    .first<number>('fileBytes');
  // Sweeps leave reservations alone, so a finalize that matches none outlived its account.
  if (fileBytes === null) return outlived(c);
  c.header(ACCOUNT_USAGE_HEADERS.fileBytes, String(fileBytes));
  return c.body(null, 204);
}

// The ids of every file the account holds, stored or only reserved, a page at a time after the last one given: what its
// sweep weighs against the objects naming files (runtime/files).
files.get('/', async (c) => {
  const after = c.req.query('after') ?? '';
  if (after && !FILE_ID.test(after)) return fail(c, 400, 'bad-input');
  const { incarnation } = c.get('account');
  const answer = await c.env.stores.withStore(incarnation, async (store) => {
    const head = await store.revision(incarnation);
    if (!('rev' in head)) return refused(c, head);
    const { results } = await c.env.db.prepare('SELECT id FROM account_files WHERE incarnation = ?1 AND id > ?2 ORDER BY id LIMIT ?3')
      .bind(incarnation, after, MAX_FILE_IDS + 1)
      .all<{ id: string }>();
    return c.json({ ids: results.slice(0, MAX_FILE_IDS).map(({ id }) => id), more: results.length > MAX_FILE_IDS, ...head });
  });
  return 'unavailable' in answer ? refused(c, answer) : answer;
});

// Fence sweeps on the same account queue/timeline/rev as object writes and share publication.
// Release unused ids only after claims settle and no live/open-report share names them.
// Reclaim named-but-unheld copies even over cap: their referring objects already exist.
files.post('/sweep', canWrite, async (c) => {
  const input = await readObject(c);
  const { timeline, rev, unused, named } = input ?? {};
  const ids = (list: unknown): list is string[] => Array.isArray(list) && list.length <= MAX_FILE_IDS && list.every((id) => typeof id === 'string' && FILE_ID.test(id));
  if (typeof timeline !== 'string' || !Number.isSafeInteger(rev) || (rev as number) < 0 || !ids(unused) || !ids(named) || unused.length + named.length > MAX_FILE_IDS) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const { incarnation } = c.get('account');
  const result = await c.env.backups.hold(() => c.env.stores.withStore(incarnation, async (store) => {
    const head = await store.revision(incarnation);
    if (!('rev' in head)) return refused(c, head);
    if (head.timeline !== timeline) return fail(c, 409, 'cache-reset');
    if (head.rev !== rev) return fail(c, 409, 'conflict');
    const now = Date.now();
    const current = `EXISTS (SELECT 1 FROM accounts WHERE incarnation = ?1 AND timeline = ?2 AND state = 'active')`;
    const [, taken, , , , , answer] = await db.batch<{ changed: number; fileBytes: number; current: number }>([
      ...takeBackFiles(db, incarnation, { ids: named, timeline }, now),
      db
        .prepare(
          `INSERT INTO file_removals (incarnation, id, size, created_at, released_at, due_at)
           SELECT f.incarnation, f.id, f.size, f.created_at, ?4, ?5 FROM account_files f
           WHERE f.incarnation = ?1 AND f.stored = 1 AND f.id IN (SELECT value FROM json_each(?3)) AND f.claimed_at <= ?4 - ${CLAIM_SETTLE_MS} AND ${current}
             AND NOT EXISTS (
               SELECT 1 FROM shares s WHERE s.incarnation = ?1
                 AND ((s.cut_at IS NULL AND s.removed_at IS NULL) OR EXISTS (SELECT 1 FROM reports r WHERE r.share = s.id AND r.resolved_at IS NULL))
                 AND (EXISTS (SELECT 1 FROM share_files WHERE share = s.id AND file = f.id) OR EXISTS (SELECT 1 FROM share_versions WHERE share = s.id AND manifest = f.id)))`,
        )
        .bind(incarnation, timeline, JSON.stringify(unused), now, now + RETENTION_MS),
      // A pair is never in both tables outside this transaction, so what they hold in common is what was just released.
      db
        .prepare('UPDATE accounts SET file_bytes = file_bytes - (SELECT COALESCE(SUM(f.size), 0) FROM account_files f JOIN file_removals r USING (incarnation, id) WHERE f.incarnation = ?1) WHERE incarnation = ?1')
        .bind(incarnation),
      db.prepare('DELETE FROM account_files WHERE incarnation = ?1 AND id IN (SELECT id FROM file_removals WHERE incarnation = ?1)').bind(incarnation),
      db.prepare("SELECT changes() AS changed, file_bytes AS fileBytes, timeline = ?2 AND state = 'active' AS current FROM accounts WHERE incarnation = ?1").bind(incarnation, timeline),
    ]);
    const { changed: released, fileBytes, current: still } = answer!.results[0]!;
    if (!still) return fail(c, 409, 'cache-reset');
    c.header(ACCOUNT_USAGE_HEADERS.fileBytes, String(fileBytes));
    return c.json({ released, taken: taken!.meta.changes });
  }));
  return 'unavailable' in result ? refused(c, result) : result;
});

// The id is the content, so the answer never changes and the browser may keep it. A block therefore stops only
// browsers that have not read the file yet.
files.get('/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return fail(c, 400, 'bad-input');
  const { incarnation } = c.get('account');
  const [file, held] = await Promise.all([
    c.env.files.get(fileKey(incarnation, id)),
    c.env.db.prepare('SELECT EXISTS (SELECT 1 FROM file_blocks WHERE id = ?2) AS blocked, EXISTS (SELECT 1 FROM account_files WHERE incarnation = ?1 AND id = ?2 AND stored = 1) AS stored')
      .bind(incarnation, id)
      .first<{ blocked: number; stored: number }>(),
  ]);
  if (held!.blocked || !held!.stored || !file) {
    void file?.cancel();
    return held!.blocked ? fail(c, 403, 'file-blocked') : fail(c, 404, 'not-found');
  }
  return c.body(file, 200, { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=31536000, immutable' });
});

// Global content block needs no holder and removes no bytes, so lifting restores every copy.
// Log before the change in one target-gated batch, never claim an action that did not happen.
export const fileBlocks = new Hono<AppEnv>().put('/files/:id/blocked', async (c) => {
  const id = c.req.param('id');
  const blocked = (await readObject(c))?.blocked;
  if (!FILE_ID.test(id) || typeof blocked !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const at = Date.now();
  await db.batch(
    blocked
      ? blockFiles(db, at, 'SELECT ?2 AS id', id)
      : [
          db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?1, 'unblock-file', id FROM file_blocks WHERE id = ?2`).bind(at, id),
          db.prepare('DELETE FROM file_blocks WHERE id = ?').bind(id),
        ],
  );
  return c.body(null, 204);
});

// The only writer of file_blocks. ids: a SELECT of the content ids to block, with its values from ?2 on; each new block
// is logged.
export function blockFiles(db: Db, at: number, ids: string, ...values: SqlValue[]): Statement[] {
  return [
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT DISTINCT ?1, 'block-file', id FROM (${ids}) WHERE id NOT IN (SELECT id FROM file_blocks)`).bind(at, ...values),
    db.prepare(`INSERT INTO file_blocks (id, blocked_at) SELECT DISTINCT id, ?1 FROM (${ids}) WHERE true ON CONFLICT DO NOTHING`).bind(at, ...values),
  ];
}
