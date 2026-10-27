import type { BoardSettings } from '../contracts/board';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { type AccountState, type BackupFolder, type RestoreAction, MAX_NOTICE_LENGTH } from '../contracts/admin';
import { savedFolder } from './backup/backups';
import { SHARE_ID } from '../contracts/shares';
import { blockFiles, fileBlocks } from './files';
import { forgetCut, serveShareFile } from './shares';
import type { Db, SqlValue, Statement } from './db/service-db';
import { fail, ID, readObject, type AppEnv, type Services } from './http';
import { answerAction, answerBegin, leaveAccount, refuseLeft, restoreFrom, restorePoints, restoresOf, store } from './lifecycle';
import { requireSession } from './session';
import { tellUnread, VISIBLE } from './unread';
import { readVisits } from './visits';

// Reports are plaintext rows no byte cap counts, so one account's unresolved ones are bounded (board.ts).
export const MAX_OPEN_REPORTS = 20;
const PAGE_ROWS = 100;
// How long a resolved report, a settled operator-only post and a log row are kept, as the privacy page says. An open
// report stays whatever its age, and a public post is never forgotten by age.
const KEEP_MS = 365 * 24 * 60 * 60 * 1000;

// Also the rows of cut links whose reports were resolved or forgotten since (shares.ts forgetCut).
export async function forgetOldRecords(db: Db): Promise<void> {
  const now = Date.now();
  const before = now - KEEP_MS;
  await db.batch([
    db.prepare('DELETE FROM reports WHERE resolved_at < ?').bind(before),
    db.prepare("DELETE FROM posts WHERE visibility = 'operator' AND status IN ('seen', 'done', 'declined') AND status_at < ?").bind(before),
    db.prepare('DELETE FROM admin_log WHERE at < ?').bind(before),
    db.prepare('DELETE FROM board_guest_address_blocks WHERE until <= ?').bind(now),
    ...forgetCut(db, 'TRUE'),
  ]);
}

// What any account, a suspended one too, reads of what the operator sent. Newest first, paged like the operator's lists.
export const notices = new Hono<AppEnv>()
  .use(requireSession)
  .get('/', async (c) => {
    const listed = await page(
      c,
      'SELECT id, text, created_at AS createdAt FROM notices',
      `EXISTS (SELECT 1 FROM accounts WHERE accounts.incarnation = ?3 AND ${VISIBLE})`,
      c.get('account').incarnation,
    );
    return listed ? c.json({ notices: listed.rows, next: listed.next }) : fail(c, 400, 'bad-input');
  })
  // id: the newest notice the page showed, so one sent since it was read stays unread.
  .post('/seen', async (c) => {
    const id = (await readObject(c))?.id;
    if (!positive(id)) return fail(c, 400, 'bad-input');
    await c.env.db.prepare('UPDATE accounts SET notices_seen = MAX(notices_seen, ?) WHERE incarnation = ?').bind(id, c.get('account').incarnation).run();
    await tellUnread(c);
    return c.body(null, 204);
  });

export const admin = new Hono<AppEnv>();

admin.use(requireSession);
admin.use(createMiddleware<AppEnv>(async (c, next) => (c.get('account').admin ? next() : fail(c, 403, 'not-admin'))));

admin.get('/visits', async (c) => c.json({ days: await readVisits(c.env.db) }));

// Atomically log then act, gated on target existence; deletion would make later target lookup impossible.
// values bind detail parameters from ?4 onward.
function logged(db: Db, action: string, id: string, detail = 'NULL', ...values: SqlValue[]) {
  return db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?1, ?2, id, ${detail} FROM accounts WHERE id = ?3`).bind(Date.now(), action, id, ...values);
}

const USERNAME = `json_object('username', username)`;

// The last statement is the action, and answers the row it wrote.
export async function act(c: Context<AppEnv>, ...statements: Statement[]) {
  const done = await c.env.db.batch(statements);
  return done.at(-1)!.results.length ? c.body(null, 204) : fail(c, 404, 'not-found');
}

const noticeText = (value: unknown) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= MAX_NOTICE_LENGTH ? text : null;
};
// The text of a notice sent with an act: null for none, blank among them; undefined for one too long to send.
const optionalText = (value: unknown) => (value === undefined || (typeof value === 'string' && !value.trim()) ? null : (noticeText(value) ?? undefined));

// Whom a notice is to: a FROM clause naming one accounts row by ?1, or null for every account.
type Target = { from: string; key: string };
const toAccount = (id: string): Target => ({ from: 'accounts WHERE accounts.id = ?1', key: id });

// The only writer of notices: its log row, then the notice, each written only if its account is there.
function noticed(db: Db, text: string, to: Target | null): Statement[] {
  const now = Date.now();
  if (!to) {
    return [
      db.prepare(`INSERT INTO admin_log (at, action, target) VALUES (?, 'send-notice', 'everyone')`).bind(now),
      db.prepare('INSERT INTO notices (text, created_at) VALUES (?, ?) RETURNING id').bind(text, now),
    ];
  }
  return [
    db
      .prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, 'send-notice', accounts.id, json_object('username', accounts.username) FROM ${to.from}`)
      .bind(to.key, now),
    db.prepare(`INSERT INTO notices (incarnation, text, created_at) SELECT accounts.incarnation, ?3, ?2 FROM ${to.from} RETURNING id`).bind(to.key, now, text),
  ];
}

// At most this many store calls are in flight, and the page is answered by the deadline with what was read by then.
const USAGE_SLOTS = 50;
const USAGE_DEADLINE_MS = 10_000;

type AccountRow = {
  accountId: string;
  username: string;
  createdAt: number;
  suspended: number;
  state: AccountState;
  incarnation: string;
  fileBytes: number;
  own_bytes_cap: number;
  bytes_cap: number | null;
  own_file_bytes_cap: number;
  file_bytes_cap: number | null;
};
const ACCOUNT_COLUMNS = `id AS accountId, username, created_at AS createdAt, suspended_at IS NOT NULL AS suspended,
  state, incarnation, file_bytes AS fileBytes, own_bytes_cap, bytes_cap, own_file_bytes_cap, file_bytes_cap`;
type Usage = { bytes: number; disk: number } | null;

// Keyset pages stay bounded after deletions and do not scan an ever-growing OFFSET. The (created_at, id) index owns
// this order; the cursor includes both because accounts can share their creation millisecond.
async function accountPage<T extends Pick<AccountRow, 'accountId' | 'createdAt'>>(c: Context<AppEnv>, columns: string, where = 'TRUE') {
  const after = c.req.query('after') ?? null;
  const limit = limitOf(c);
  const split = after?.indexOf(':') ?? 0;
  const at = Number(after?.slice(0, split));
  const id = after?.slice(split + 1) ?? '';
  if (limit === null || (after !== null && (split < 1 || !count(at) || !ID.test(id)))) return null;
  const rows = after === null
    ? c.env.db.prepare(`SELECT ${columns} FROM accounts WHERE ${where} ORDER BY created_at, id LIMIT ?`).bind(limit)
    : c.env.db.prepare(`SELECT ${columns} FROM accounts WHERE (created_at, id) > (?, ?) AND ${where} ORDER BY created_at, id LIMIT ?`).bind(at, id, limit);
  const { results } = await rows.all<T>();
  return { rows: results, next: results.length === limit ? `${results.at(-1)!.createdAt}:${results.at(-1)!.accountId}` : null };
}

// bytes/disk stay null for inactive/unread/failed stores; own caps use default when inherited.
// flagged filters suspended/restoring/leaving. Service totals are separate /usage reads.
admin.get('/accounts', async (c) => {
  const listed = await accountPage<AccountRow>(c, ACCOUNT_COLUMNS, c.req.query('flagged') === '1' ? "(suspended_at IS NOT NULL OR state != 'active')" : 'TRUE');
  if (!listed) return fail(c, 400, 'bad-input');
  const usages = await accountUsage(c.env, listed.rows);
  return c.json({ accounts: listed.rows.map((row, index) => shownAccount(row, usages[index]!)), next: listed.next });
});

// Each request calls only this page's stores and answers sums. Ordinary actions never start this scan.
admin.get('/usage', async (c) => {
  const listed = await accountPage<Pick<AccountRow, 'accountId' | 'createdAt' | 'state' | 'incarnation'>>(c, 'id AS accountId, created_at AS createdAt, state, incarnation');
  if (!listed) return fail(c, 400, 'bad-input');
  const totals = { bytes: 0, disk: 0, unread: 0 };
  for (const usage of await accountUsage(c.env, listed.rows)) {
    if (usage === null) totals.unread++;
    else {
      totals.bytes += usage.bytes;
      totals.disk += usage.disk;
    }
  }
  return c.json({ totals: { ...totals, readAt: Date.now() }, accounts: listed.rows.length, next: listed.next });
});

// A change refreshes only its row. A deleted account is absent rather than a reason to reload the service.
admin.get('/accounts/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return fail(c, 400, 'bad-input');
  const row = await c.env.db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).bind(id).first<AccountRow>();
  const usage = row ? (await accountUsage(c.env, [row]))[0]! : null;
  return c.json({ account: row ? shownAccount(row, usage) : null });
});

async function accountUsage(env: Services, rows: Pick<AccountRow, 'state' | 'incarnation'>[]): Promise<Usage[]> {
  const answers = await readAll(
    rows.map(({ state, incarnation }) => (state === 'active' ? () => store(env, incarnation).usage(incarnation) : null)),
    USAGE_SLOTS,
    USAGE_DEADLINE_MS,
  );
  return answers.map((usage) => usage && 'bytes' in usage ? usage : null);
}

function shownAccount(row: AccountRow, usage: Usage) {
  return {
    accountId: row.accountId,
    username: row.username,
    createdAt: row.createdAt,
    suspended: Boolean(row.suspended),
    state: row.state,
    bytes: usage?.bytes ?? null,
    disk: usage?.disk ?? null,
    fileBytes: row.fileBytes,
    bytesCap: row.own_bytes_cap ? row.bytes_cap : 'default',
    fileBytesCap: row.own_file_bytes_cap ? row.file_bytes_cap : 'default',
  };
}

// Hold slots until nonabortable calls settle. At deadline stop dispatching and return undefined for unfinished calls;
// late answers must not mutate the returned page.
export async function readAll<T>(calls: ((() => Promise<T>) | null)[], slots: number, deadlineMs: number): Promise<(T | undefined)[]> {
  const settled: (T | undefined)[] = calls.map(() => undefined);
  let next = 0;
  let open = true;
  const slot = async () => {
    while (open && next < calls.length) {
      const index = next++;
      const call = calls[index];
      if (!call) continue;
      const answer = await call().catch(() => undefined);
      if (open) settled[index] = answer;
    }
  };
  let reached = () => {};
  const deadline = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const timer = setTimeout(reached, deadlineMs);
  await Promise.race([Promise.all(Array.from({ length: slots }, slot)), deadline]);
  open = false;
  clearTimeout(timer);
  return settled;
}

// to: an account id, or null for every account.
admin.post('/notices', async (c) => {
  const body = await readObject(c);
  const to = body?.to;
  const text = noticeText(body?.text);
  if (!text || !(to === null || (typeof to === 'string' && ID.test(to)))) return fail(c, 400, 'bad-input');
  return act(c, ...noticed(c.env.db, text, to === null ? null : toAccount(to)));
});

// reason: a notice to the account, sent with the change. A suspension cannot go without one: the terms promise every
// suspended account is told why.
admin.put('/accounts/:id/suspended', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const suspended = body?.suspended;
  const reason = optionalText(body?.reason);
  if (!ID.test(id) || typeof suspended !== 'boolean' || reason === undefined || (suspended && reason === null)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  return act(
    c,
    logged(db, suspended ? 'suspend' : 'lift', id, USERNAME),
    ...(reason === null ? [] : noticed(db, reason, toAccount(id))),
    db.prepare('UPDATE accounts SET suspended_at = ? WHERE id = ? RETURNING id').bind(suspended ? Date.now() : null, id),
  );
});

// Each cap: a count of bytes, null for none, or 'default' for the service's.
admin.put('/accounts/:id/caps', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const bytesCap = body?.bytesCap;
  const fileBytesCap = body?.fileBytesCap;
  if (!ID.test(id) || !ownCap(bytesCap) || !ownCap(fileBytesCap)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const own = (cap: number | null | 'default') => [cap === 'default' ? 0 : 1, cap === 'default' ? null : cap];
  return act(
    c,
    logged(db, 'set-caps', id, `json_object('username', username, 'bytesCap', json(?4), 'fileBytesCap', json(?5))`, JSON.stringify(bytesCap), JSON.stringify(fileBytesCap)),
    db.prepare('UPDATE accounts SET own_bytes_cap = ?2, bytes_cap = ?3, own_file_bytes_cap = ?4, file_bytes_cap = ?5 WHERE id = ?1 RETURNING id').bind(id, ...own(bytesCap), ...own(fileBytesCap)),
  );
});

// What stays is what stays after 탈퇴 (accounts.ts). Repeatable: it finishes a leaving account (마무리).
admin.delete('/accounts/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID.test(id)) return fail(c, 400, 'bad-input');
  const incarnation = await incarnationOf(c, id);
  if (incarnation === null) return fail(c, 404, 'not-found');
  const left = await leaveAccount(c.env, c.executionCtx, id, incarnation, true);
  if (left !== 'left') return refuseLeft(c, left);
  return c.body(null, 204);
});

admin.post('/accounts/:id/restores', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const post = body?.post;
  const from = restoreFrom(body);
  if (!ID.test(id) || !positive(post) || !from) return fail(c, 400, 'bad-input');
  return answerBegin(c, id, post, from);
});

const incarnationOf = (c: Context<AppEnv>, id: string) => c.env.db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(id).first<string>('incarnation');

admin.get('/accounts/:id/points', async (c) => {
  const points = await restorePoints(c.env.db, c.req.param('id'));
  return points ? c.json({ points }) : fail(c, 404, 'not-found');
});

admin.get('/accounts/:id/restores', async (c) => c.json({ restores: await restoresOf(c.env.db, c.req.param('id')) }));

admin.post('/restores/:id/:action{resume|finalize|cancel}', async (c) => {
  const id = Number(c.req.param('id'));
  if (!positive(id)) return fail(c, 400, 'bad-input');
  return answerAction(c, id, c.req.param('action') as RestoreAction);
});

admin.get('/board', async (c) => c.json({ guests: (await c.env.db.prepare('SELECT board_guests FROM service').first<number>('board_guests')) === 1 } satisfies BoardSettings));

admin.put('/board', async (c) => {
  const body = await readObject(c);
  if (typeof body?.guests !== 'boolean') return fail(c, 400, 'bad-input');
  await c.env.db.batch([
    c.env.db.prepare('UPDATE service SET board_guests = ?').bind(Number(body.guests)),
    c.env.db.prepare("INSERT INTO admin_log (at, action, target, detail) VALUES (?, 'set-board', 'service', ?)").bind(Date.now(), JSON.stringify({ guests: body.guests })),
  ]);
  return c.body(null, 204);
});

admin.get('/service', async (c) => {
  const row = await c.env.db.prepare(
    `SELECT signup_cap AS signupCap, account_bytes_cap AS accountBytesCap, account_file_bytes_cap AS accountFileBytesCap,
       (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM accounts WHERE state != 'leaving') AS people,
       (SELECT COUNT(*) FROM reports WHERE resolved_at IS NULL) + (SELECT COUNT(*) FROM shares WHERE held_at IS NOT NULL AND removed_at IS NULL)
         + (SELECT COUNT(*) FROM posts WHERE visibility = 'operator' AND status = 'open' AND deleted = 0) AS pending,
       (SELECT COALESCE(SUM(file_bytes), 0) FROM accounts) AS fileBytes,
       (SELECT COUNT(*) FROM shares WHERE cut_at IS NULL) AS links,
       (SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()) AS databaseBytes
     FROM service`,
  ).first();
  const backups = c.env.backups;
  const backupFolder: BackupFolder | undefined = backups.copier === 'folder' ? { path: await savedFolder(c.env), failure: backups.copyFailure() } : undefined;
  return c.json({ ...row, ...(await backups.freshness(c.env, Date.now())), backupFolder });
});

// null clears it. A saved folder is copied to at once, so its first pass is not an hour away.
admin.put('/backup-folder', async (c) => {
  if (c.env.backups.copier !== 'folder') return fail(c, 404, 'not-found');
  const body = await readObject(c);
  const typed = body?.folder;
  if (typed !== null && typeof typed !== 'string') return fail(c, 400, 'bad-input');
  const checked = typed === null ? { ok: true as const, folder: null } : await c.env.backups.checkFolder(typed);
  if (!checked.ok) return fail(c, 400, checked.error);
  const db = c.env.db;
  await db.batch([
    db.prepare("INSERT INTO admin_log (at, action, target, detail) VALUES (?, 'set-backup-folder', 'service', ?)").bind(Date.now(), JSON.stringify({ folder: checked.folder })),
    db.prepare('UPDATE service SET backup_folder = ?').bind(checked.folder),
  ]);
  c.executionCtx.waitUntil(c.env.backups.tick(c.env, Date.now()));
  return c.body(null, 204);
});

const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const positive = (value: unknown): value is number => count(value) && value > 0;
const cap = (value: unknown) => value === null || count(value);
const ownCap = (value: unknown) => value === 'default' || cap(value);

admin.put('/service', async (c) => {
  const body = await readObject(c);
  const signupCap = body?.signupCap;
  const accountBytesCap = body?.accountBytesCap;
  const accountFileBytesCap = body?.accountFileBytesCap;
  if (!count(signupCap) || !cap(accountBytesCap) || !cap(accountFileBytesCap)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  await db.batch([
    db.prepare(`INSERT INTO admin_log (at, action, target, detail) VALUES (?, 'set-service', 'service', ?)`).bind(Date.now(), JSON.stringify({ signupCap, accountBytesCap, accountFileBytesCap })),
    db.prepare('UPDATE service SET signup_cap = ?, account_bytes_cap = ?, account_file_bytes_cap = ?').bind(signupCap, accountBytesCap, accountFileBytesCap),
  ]);
  return c.body(null, 204);
});

// Newest-first keyset pages: after is prior next, limit defaults/caps to PAGE_ROWS, short pages end with null.
// where binds extra filters from ?3 onward.
async function page<T extends { id: number }>(c: Context<AppEnv>, select: string, where = 'TRUE', ...values: SqlValue[]) {
  const after = c.req.query('after');
  const limit = limitOf(c);
  if ((after !== undefined && !/^[1-9]\d{0,15}$/.test(after)) || limit === null) return null;
  const { results } = await c.env.db
    .prepare(`${select} WHERE (?1 IS NULL OR id < ?1) AND ${where} ORDER BY id DESC LIMIT ?2`)
    .bind(after === undefined ? null : Number(after), limit, ...values)
    .all<T>();
  return { rows: results, next: results.length === limit ? String(results.at(-1)!.id) : null };
}

export function limitOf(c: Context<AppEnv>) {
  const limit = c.req.query('limit');
  if (limit === undefined) return PAGE_ROWS;
  return /^[1-9]\d{0,2}$/.test(limit) && Number(limit) <= PAGE_ROWS ? Number(limit) : null;
}

// Read current share state, not report-time state; reviewed holds/blocks do not auto-hold again.
// Null means the share left with its account.
type ShareRow = { held: number; reviewed: number; cut: number; removed: number; ownerId: string | null; ownerName: string | null };
const SHARED = `(SELECT json_object('held', s.held_at IS NOT NULL, 'reviewed', s.reviewed_at IS NOT NULL, 'cut', s.cut_at IS NOT NULL,
    'removed', s.removed_at IS NOT NULL, 'ownerId', a.id, 'ownerName', a.username)
  FROM shares s LEFT JOIN accounts a ON a.incarnation = s.incarnation WHERE s.id = reports.share)`;

// open excludes resolved reports. Board reports expose current target text and reporter nickname, null once absent.
admin.get('/reports', async (c) => {
  const listed = await page<{ id: number; share: string | null; shared: string | null }>(
    c,
    `SELECT id, account_id AS accountId, CASE WHEN share IS NULL THEN (SELECT name FROM board_names WHERE board_names.account_id = reports.account_id) ELSE username END AS username,
       text, created_at AS createdAt, resolved_at AS resolvedAt, share, share_version AS shareVersion, link, ${SHARED} AS shared,
       post_id AS postId, comment_id AS commentId, (SELECT title FROM posts WHERE posts.id = reports.post_id) AS postTitle,
       (SELECT text FROM comments WHERE comments.id = reports.comment_id) AS commentText FROM reports`,
    c.req.query('open') === '1' ? 'resolved_at IS NULL' : 'TRUE',
  );
  if (!listed) return fail(c, 400, 'bad-input');
  return c.json({
    next: listed.next,
    reports: listed.rows.map(({ shared, ...row }) => {
      const state = shared === null ? null : (JSON.parse(shared) as ShareRow);
      return { ...row, shared: state && { held: Boolean(state.held), reviewed: Boolean(state.reviewed), cut: Boolean(state.cut), removed: Boolean(state.removed), ownerId: state.ownerId, ownerName: state.ownerName } };
    }),
  });
});

admin.post('/reports/:id/resolve', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const now = Date.now();
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'resolve-report', id FROM reports WHERE id = ?1 AND resolved_at IS NULL`).bind(id, now),
    db.prepare('UPDATE reports SET resolved_at = ?2 WHERE id = ?1 AND resolved_at IS NULL RETURNING id').bind(id, now),
  );
});

admin.route('/', fileBlocks);

// 열어 보기: a share's versions in any state. The report's link holds the key.
admin.get('/shares/:id', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const { results } = await c.env.db.prepare('SELECT version, manifest, created_at AS createdAt FROM share_versions WHERE share = ? ORDER BY version').bind(id).all();
  return results.length ? c.json({ versions: results }) : fail(c, 404, 'not-found');
});

admin.get('/shares/:id/files/:file', (c) => serveShareFile(c, true));

// 보류, with or without a report: both anonymous reads answer held until the operator lifts it or blocks the share.
admin.post('/shares/:id/hold', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const now = Date.now();
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'hold-share', id FROM shares WHERE id = ?1 AND held_at IS NULL AND removed_at IS NULL`).bind(id, now),
    db.prepare('UPDATE shares SET held_at = ?2 WHERE id = ?1 AND held_at IS NULL AND removed_at IS NULL RETURNING id').bind(id, now),
  );
});

// 보류 풀기: the link opens again, its open reports are resolved, and it is reviewed: a later report goes to the inbox
// without holding it.
admin.post('/shares/:id/release', async (c) => {
  const id = c.req.param('id');
  if (!SHARE_ID.test(id)) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const now = Date.now();
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'release-share', id FROM shares WHERE id = ?1 AND removed_at IS NULL`).bind(id, now),
    resolveShareReports(db, id, now),
    db.prepare('UPDATE shares SET held_at = NULL, held_report = NULL, reviewed_at = ?2 WHERE id = ?1 AND removed_at IS NULL RETURNING id').bind(id, now),
  );
});

// Block the reviewed version's file ids across accounts, resolve reports and notify/suspend atomically.
// Departed sharers have no account to notify: not-found.
admin.post('/shares/:id/block', async (c) => {
  const id = c.req.param('id');
  const body = await readObject(c);
  const version = body?.version;
  const notice = noticeText(body?.notice);
  const suspend = body?.suspend;
  if (!SHARE_ID.test(id) || !positive(version) || !notice || typeof suspend !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const owner = await db
    .prepare('SELECT a.id FROM shares s JOIN accounts a ON a.incarnation = s.incarnation WHERE s.id = ? AND s.removed_at IS NULL AND EXISTS (SELECT 1 FROM share_versions WHERE share = s.id AND version = ?)')
    .bind(id, version)
    .first<string>('id');
  if (owner === null) return fail(c, 404, 'not-found');
  const now = Date.now();
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, 'block-share', id, json_object('version', ?3) FROM shares WHERE id = ?1 AND removed_at IS NULL`).bind(id, now, version),
    ...blockFiles(db, now, 'SELECT file AS id FROM share_files WHERE share = ?2 AND version = ?3', id, version),
    ...noticed(db, notice, toAccount(owner)),
    ...(suspend ? [logged(db, 'suspend', owner, USERNAME), db.prepare('UPDATE accounts SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL').bind(now, owner)] : []),
    resolveShareReports(db, id, now),
    db.prepare('UPDATE shares SET removed_at = ?2, reviewed_at = ?2 WHERE id = ?1 AND removed_at IS NULL RETURNING id').bind(id, now),
  );
});

const resolveShareReports = (db: Db, share: string, at: number) => db.prepare('UPDATE reports SET resolved_at = ? WHERE share = ? AND resolved_at IS NULL').bind(at, share);

admin.get('/log', async (c) => {
  const listed = await page<{ id: number; detail: string | null }>(c, 'SELECT id, at, action, target, detail FROM admin_log');
  if (!listed) return fail(c, 400, 'bad-input');
  return c.json({ log: listed.rows.map((row) => ({ ...row, detail: row.detail === null ? null : (JSON.parse(row.detail) as unknown) })), next: listed.next });
});
