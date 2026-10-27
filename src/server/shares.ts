import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { claimFiles } from './files/claims';
import { createMiddleware } from 'hono/factory';
import { MAX_REPORT_LENGTH } from '../contracts/admin';
import { FILE_ID } from '../contracts/files';
import { ACCOUNT_USAGE_HEADERS, VISITOR_HEADER } from '../contracts/http';
import { COVER_LENGTH, MAX_SHARE_FILES, MAX_SHARE_LINK, SHARE_CONSENT, SHARE_ID, SHARE_LIMITS, type ShareCover, type ShareState } from '../contracts/shares';
import { ROW_BYTES } from './caps';
import type { Db, SqlValue, Statement } from './db/service-db';
import { fileKey } from './files/bucket';
import { fail, isRecord, readObject, refused as refuseStore, RETRY_SECONDS, type AppEnv } from './http';
import { tokenBucket } from './limits';
import { canWrite, currentAccount, requireSession } from './session';

// Keep only sealed manifests and plain file ids; link keys stay in fragments until a report submits its full link.

// A publish names up to MAX_SHARE_FILES content ids of 64 characters each.
export const PUBLISH_BYTES = 1_000_000;
// What one link's reports may hold unresolved; reports are plaintext rows no byte cap counts.
const MAX_OPEN_REPORTS = 50;
// Every anonymous answer is read fresh: a hold or a block must stop the next read, not the next expiry.
const FRESH = { 'cache-control': 'no-store' };
// A share's state, over a shares row named s.
// A suspended sharer's links read as held while the suspension lasts, stored state untouched, so lifting it brings
// them back.
const HELD = '(s.held_at IS NOT NULL OR EXISTS (SELECT 1 FROM accounts WHERE accounts.incarnation = s.incarnation AND accounts.suspended_at IS NOT NULL))';
const LIVE = `s.cut_at IS NULL AND s.removed_at IS NULL AND NOT ${HELD}`;

type Visits = 'reads' | 'files' | 'reports';
// The anonymous routes count per visitor, as the public listener saw them (VISITOR_HEADER). A request that did not
// come through it, as in tests, counts as one visitor.
const visits = (kind: Visits) =>
  createMiddleware<AppEnv>(async (c, next) => (c.env.limits.visitors[kind].limit(c.req.header(VISITOR_HEADER) ?? 'direct').success ? next() : fail(c, 429, 'too-many-visits')));

const newShareId = () => randomBytes(12).toString('base64url');

function readCover(value: unknown): ShareCover | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const cover: Record<string, string> = {};
  for (const [field, most] of Object.entries(COVER_LENGTH)) {
    const text = value[field];
    if (typeof text !== 'string' || text.trim().length > most) return undefined;
    cover[field] = text.trim();
  }
  return cover.name ? (cover as ShareCover) : undefined;
}

// What a publish names: the sealed manifest and the version's pictures, all already stored among the sharer's files.
async function readVersion(c: Context<AppEnv>) {
  const body = await readObject(c);
  const manifest = body?.manifest;
  const files = body?.files;
  const cover = readCover(body?.cover);
  if (typeof manifest !== 'string' || !FILE_ID.test(manifest) || !Array.isArray(files) || files.length > MAX_SHARE_FILES || cover === undefined) return null;
  if (!files.every((file): file is string => typeof file === 'string' && FILE_ID.test(file))) return null;
  return { manifest, files: [...new Set(files)], cover };
}

// Per account, links and versions together, refused before the body is read, as is an account that has not agreed
// to the current consent.
const publishes = tokenBucket(SHARE_LIMITS.publishesPerHour, 60 * 60_000);
const publishable = createMiddleware<AppEnv>(async (c, next) => {
  const { id, incarnation } = c.get('account');
  const taken = publishes.limit(id);
  if (!taken.success) return fail(c, 429, 'too-many-publishes', { retryAfter: taken.retryAfter });
  const consent = await c.env.db.prepare('SELECT share_consent FROM accounts WHERE incarnation = ?').bind(incarnation).first<number>('share_consent');
  return consent === SHARE_CONSENT ? next() : fail(c, 403, 'no-consent');
});

// Reject capped billed rows, foreign files and blocked pictures before publication; blocked content must not
// reappear under a new link. billed includes the account's resulting usage.
async function refusal(c: Context<AppEnv>, billed: number, manifest: string, files: string[]) {
  const { incarnation, bytesCap } = c.get('account');
  if (bytesCap !== null && billed > bytesCap) return fail(c, 413, 'storage-full');
  const claimed = await claimFiles(c.env.db, incarnation, [manifest, ...files]);
  c.header(ACCOUNT_USAGE_HEADERS.fileBytes, String(claimed.fileBytes));
  if (claimed.removing) return fail(c, 503, 'busy', { retryAfter: RETRY_SECONDS });
  if (claimed.blocked) return fail(c, 403, 'file-blocked');
  if (claimed.missing) return fail(c, 400, 'bad-input');
  return null;
}

// bytes: what the account is billed, read on the queue its object writes take.
// link: the publish makes a new link.
const added = (link: boolean, files: string[]) => (link ? ROW_BYTES.share : 0) + ROW_BYTES.shareFile * (1 + files.length);

async function publishing(c: Context<AppEnv>, write: (bytes: number) => Promise<Response>): Promise<Response> {
  const { incarnation } = c.get('account');
  const result = await c.env.backups.hold(() => c.env.stores.withStore(incarnation, async (store) => {
    const usage = await store.usage(incarnation);
    return 'bytes' in usage ? write(usage.bytes) : refuseStore(c, usage);
  }));
  return 'unavailable' in result ? refuseStore(c, result) : result;
}

export const shares = new Hono<AppEnv>();

// The account's consent at its current version, which every publish asks for.
shares.put('/consent', requireSession, async (c) => {
  await c.env.db.prepare('UPDATE accounts SET share_consent = ?, share_consent_at = ? WHERE incarnation = ?').bind(SHARE_CONSENT, Date.now(), c.get('account').incarnation).run();
  return c.body(null, 204);
});

// The account's links not cut, newest first, and the consent it agreed to.
shares.get('/mine', requireSession, async (c) => {
  const { incarnation } = c.get('account');
  const [consent, { results }] = await Promise.all([
    c.env.db.prepare('SELECT share_consent FROM accounts WHERE incarnation = ?').bind(incarnation).first<number | null>('share_consent'),
    c.env.db
      .prepare(
        `SELECT s.id, s.created_at AS createdAt, s.received, s.held_at IS NOT NULL AS held, s.removed_at IS NOT NULL AS removed, s.cover IS NOT NULL AS covered,
           (SELECT MAX(version) FROM share_versions WHERE share = s.id) AS version
         FROM shares s WHERE s.incarnation = ? AND s.cut_at IS NULL ORDER BY s.created_at DESC`,
      )
      .bind(incarnation)
      .all<{ held: number; removed: number; covered: number }>(),
  ]);
  return c.json({ consent, shares: results.map((row) => ({ ...row, held: Boolean(row.held), removed: Boolean(row.removed), covered: Boolean(row.covered) })) });
});

shares.post('/', requireSession, canWrite, publishable, async (c) => {
  const version = await readVersion(c);
  if (!version) return fail(c, 400, 'bad-input');
  return publishing(c, async (bytes) => {
    const db = c.env.db;
    const links = await db.prepare('SELECT COUNT(*) AS n FROM shares WHERE incarnation = ? AND cut_at IS NULL').bind(c.get('account').incarnation).first<number>('n');
    if (links! >= SHARE_LIMITS.links) return fail(c, 429, 'too-many-shares');
    const billed = bytes + added(true, version.files);
    const refused = await refusal(c, billed, version.manifest, version.files);
    if (refused) return refused;
    const id = newShareId();
    const now = Date.now();
    await db.batch([
      db.prepare('INSERT INTO shares (id, incarnation, created_at, cover) VALUES (?, ?, ?, ?)').bind(id, c.get('account').incarnation, now, version.cover && JSON.stringify(version.cover)),
      db.prepare('INSERT INTO share_versions (share, version, manifest, created_at) VALUES (?, 1, ?, ?)').bind(id, version.manifest, now),
      db.prepare('INSERT INTO share_files (share, version, file) SELECT ?1, 1, value FROM json_each(?2)').bind(id, JSON.stringify(version.files)),
    ]);
    c.header(ACCOUNT_USAGE_HEADERS.bytes, String(billed));
    return c.json({ id, version: 1 }, 201);
  });
});

// 새 버전으로 바꾸기: the link stays and opens this version from now on. A held link takes none until the operator has
// looked: the version the report showed is the one under review.
shares.post('/:id/versions', requireSession, canWrite, publishable, async (c) => {
  const id = c.req.param('id');
  const version = await readVersion(c);
  if (!SHARE_ID.test(id) || !version) return fail(c, 400, 'bad-input');
  return publishing(c, async (bytes) => {
    const db = c.env.db;
    const row = await db
      .prepare(`SELECT s.held_at IS NOT NULL AS held, s.cut_at IS NULL AND s.removed_at IS NULL AS open, (SELECT MAX(version) FROM share_versions WHERE share = s.id) AS version FROM shares s WHERE s.id = ? AND s.incarnation = ?`)
      .bind(id, c.get('account').incarnation)
      .first<{ held: number; open: number; version: number }>();
    if (!row?.open) return fail(c, 404, 'not-found');
    if (row.held) return fail(c, 403, 'share-held');
    if (row.version >= SHARE_LIMITS.versions) return fail(c, 429, 'too-many-versions');
    const billed = bytes + added(false, version.files);
    const refused = await refusal(c, billed, version.manifest, version.files);
    if (refused) return refused;
    const next = row.version + 1;
    await db.batch([
      db.prepare('INSERT INTO share_versions (share, version, manifest, created_at) VALUES (?, ?, ?, ?)').bind(id, next, version.manifest, Date.now()),
      db.prepare('INSERT INTO share_files (share, version, file) SELECT ?1, ?2, value FROM json_each(?3)').bind(id, next, JSON.stringify(version.files)),
      // A review covers the version reviewed: a new one is held again by its first report.
      db.prepare('UPDATE shares SET cover = ?, reviewed_at = NULL WHERE id = ?').bind(version.cover && JSON.stringify(version.cover), id),
    ]);
    c.header(ACCOUNT_USAGE_HEADERS.bytes, String(billed));
    return c.json({ id, version: next });
  });
});

// The opt-in embed text, turned on or off at once; null turns it off.
shares.put('/:id/cover', requireSession, canWrite, async (c) => {
  const id = c.req.param('id');
  const cover = readCover((await readObject(c))?.cover);
  if (!SHARE_ID.test(id) || cover === undefined) return fail(c, 400, 'bad-input');
  const set = await c.env.db.prepare('UPDATE shares SET cover = ? WHERE id = ? AND incarnation = ? AND cut_at IS NULL RETURNING id').bind(cover && JSON.stringify(cover), id, c.get('account').incarnation).first();
  return set ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// Retain cut-link content while an open report needs it; later forgetOldRecords removes it.
// Cutting never removes the sharer's stored files.
shares.delete('/:id', requireSession, async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const [cut] = await db.batch([
    db.prepare('UPDATE shares SET cut_at = ? WHERE id = ? AND incarnation = ? AND cut_at IS NULL RETURNING id').bind(Date.now(), id, c.get('account').incarnation),
    ...forgetCut(db, 's.id = ?1 AND s.incarnation = ?2', id, c.get('account').incarnation),
  ]);
  return cut!.results.length ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// For cut links without open reports, remove version/file refs first. Keep the link row while any report,
// including resolved ones, still names it. over filters shares alias s with parameters from ?1.
export function forgetCut(db: Db, over: string, ...values: SqlValue[]): Statement[] {
  return [
    db.prepare(`DELETE FROM share_versions WHERE share IN (SELECT s.id FROM shares s WHERE s.cut_at IS NOT NULL AND ${over}
      AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.share = s.id AND r.resolved_at IS NULL))`).bind(...values),
    db.prepare(`DELETE FROM shares AS s WHERE s.cut_at IS NOT NULL AND ${over} AND NOT EXISTS (SELECT 1 FROM reports r WHERE r.share = s.id)`).bind(...values),
  ];
}

// Anonymous from here on.

shares.get('/:id', visits('reads'), async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const row = await c.env.db
    .prepare(
      `SELECT ${HELD} AS held, s.cut_at IS NULL AND s.removed_at IS NULL AS open, s.received, v.version, v.manifest
       FROM shares s JOIN share_versions v ON v.share = s.id WHERE s.id = ? ORDER BY v.version DESC LIMIT 1`,
    )
    .bind(id)
    .first<{ held: number; open: number; received: number; version: number; manifest: string }>();
  const state: ShareState = !row?.open ? { state: 'gone' } : row.held ? { state: 'held' } : { state: 'live', version: row.version, manifest: row.manifest, received: row.received };
  return c.json(state, 200, FRESH);
});

// The embed's text for the /s/:id page (static.ts), only while the link is live.
shares.get('/:id/cover', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const cover = await c.env.db.prepare(`SELECT s.cover FROM shares s WHERE s.id = ? AND ${LIVE}`).bind(id).first<string | null>('cover');
  return c.json({ cover: cover ? (JSON.parse(cover) as ShareCover) : null }, 200, FRESH);
});

shares.get('/:id/files/:file', visits('files'), (c) => serveShareFile(c, false));

// The 받은 횟수: a visitor finished 헤이젤로 가져오기 or 파일로 받기, counted once a day per visitor.
shares.post('/:id/received', visits('reads'), async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const first = c.env.limits.visitors.received.add(`${id}\0${c.req.header(VISITOR_HEADER) ?? 'direct'}`, '') === 'new';
  const counted = await c.env.db.prepare(`UPDATE shares AS s SET received = received + ? WHERE s.id = ? AND ${LIVE} RETURNING id`).bind(Number(first), id).first();
  return counted ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// The first report atomically holds an unreviewed share. Once reviewed, only the operator may hold it again,
// preventing repeated reports from overriding review. Signed-in reporters are identified; link holders may also report.
shares.post('/:id/reports', visits('reports'), async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const link = body?.link;
  const version = body?.version;
  if (!SHARE_ID.test(id) || !text || text.length > MAX_REPORT_LENGTH || typeof link !== 'string' || link.length > MAX_SHARE_LINK || !link.includes(`/s/${id}#`)) return fail(c, 400, 'bad-input');
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return fail(c, 400, 'bad-input');
  const reporter = await currentAccount(c);
  const db = c.env.db;
  const now = Date.now();
  const [sent] = await db.batch([
    db
      .prepare(
        `INSERT INTO reports (account_id, username, text, created_at, share, share_version, link)
         SELECT ?1, ?2, ?3, ?4, s.id, ?6, ?7 FROM shares s WHERE s.id = ?5 AND s.cut_at IS NULL AND s.removed_at IS NULL
           AND EXISTS (SELECT 1 FROM share_versions WHERE share = s.id AND version = ?6)
           AND (SELECT COUNT(*) FROM reports WHERE share = ?5 AND resolved_at IS NULL) < ?8
         RETURNING id`,
      )
      .bind(reporter?.id ?? null, reporter?.username ?? null, text, now, id, version, link, MAX_OPEN_REPORTS),
    db.prepare('UPDATE shares SET held_at = ?2, held_report = last_insert_rowid() WHERE id = ?1 AND held_at IS NULL AND reviewed_at IS NULL AND changes() = 1').bind(id, now),
  ]);
  if (sent!.results.length) return c.body(null, 204);
  const open = await db.prepare('SELECT 1 FROM shares s WHERE s.id = ? AND s.cut_at IS NULL AND s.removed_at IS NULL').bind(id).first();
  return open ? fail(c, 429, 'too-many-reports') : fail(c, 404, 'not-found');
});

// Serve the sharer's copy only for a live link and unblocked file; guarded operator reads bypass those states for review.
export async function serveShareFile(c: Context<AppEnv>, operator: boolean) {
  const id = c.req.param('id')!;
  const file = c.req.param('file')!;
  if (!SHARE_ID.test(id) || !FILE_ID.test(file)) return fail(c, 400, 'bad-input');
  c.header('cache-control', FRESH['cache-control']);
  const row = await c.env.db
    .prepare(
      `SELECT s.incarnation, ${HELD} AS held, s.cut_at IS NULL AND s.removed_at IS NULL AS open,
         EXISTS (SELECT 1 FROM share_files WHERE share = s.id AND file = ?2) OR EXISTS (SELECT 1 FROM share_versions WHERE share = s.id AND manifest = ?2) AS named,
         EXISTS (SELECT 1 FROM file_blocks WHERE id = ?2) AS blocked,
         EXISTS (SELECT 1 FROM account_files WHERE incarnation = s.incarnation AND id = ?2 AND stored = 1) AS stored
       FROM shares s WHERE s.id = ?1`,
    )
    .bind(id, file)
    .first<{ incarnation: string; held: number; open: number; named: number; blocked: number; stored: number }>();
  if (!row?.named || !row.stored || (!operator && !row.open)) return fail(c, 404, 'not-found');
  if (!operator && row.held) return fail(c, 403, 'share-held');
  if (!operator && row.blocked) return fail(c, 403, 'file-blocked');
  const body = await c.env.files.get(fileKey(row.incarnation, file));
  if (!body) return fail(c, 404, 'not-found');
  return c.body(body, 200, { 'content-type': 'application/octet-stream' });
}
