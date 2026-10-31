import { createHmac } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { MAX_REPORT_LENGTH } from '../contracts/admin';
import {
  CATEGORIES,
  HOLD_DAYS_MAX,
  GUEST_BOARD_HEADER,
  MAX_COMMENT_LENGTH,
  MAX_DIAGNOSTICS_LENGTH,
  MAX_POST_LENGTH,
  MAX_POST_PICTURES,
  MAX_REASON_LENGTH,
  MAX_TITLE_LENGTH,
  nicknameKey,
  OPERATOR_NAME,
  PICTURES_PER_DAY,
  SORTS,
  STATUSES,
  validNickname,
  type Activity,
  type Author,
  type Comment,
  type Hidden,
  type Post,
  type PostPicture,
  type PostRow,
} from '../contracts/board';
import { ACCOUNT_HEADER, VISITOR_HEADER } from '../contracts/http';
import { act, limitOf, MAX_OPEN_REPORTS, positive } from './admin';
import type { SqlValue } from './db/service-db';
import { DAY_MS, fail, readObject, sha256Hex, type Account, type AppEnv } from './http';
import { boardDailyLimit } from './limits';
import { requireSession } from './session';
import { activity, hidden, OPERATOR, tellUnread } from './unread';

// A page stating an account always goes through its session, whatever guest secret it carries. Guests may only
// read posts and use the author routes: 추천, 신고, nicknames and activity remain account-only.
const GUEST_ROUTES = /^\/api\/board\/(posts(\/[^/]+(\/comments)?)?|comments\/[^/]+)$/;
export const board = new Hono<AppEnv>().use(async (c, next) => {
  if (!GUEST_ROUTES.test(c.req.path) || c.req.header(ACCOUNT_HEADER) !== undefined) return requireSession(c, next);
  if (!c.env.limits.visitors.reads.limit(c.req.header(VISITOR_HEADER) ?? 'direct').success) return fail(c, 429, 'too-many-visits');
  if (c.req.method !== 'GET') {
    const secret = guestSecret(c);
    if (!secret) return fail(c, 401, 'no-session');
    const settings = await c.env.db.prepare('SELECT board_guests, board_guest_key FROM service').first<{ board_guests: number; board_guest_key: string }>();
    if (!settings!.board_guests) return fail(c, 403, 'guest-board-closed');
    const address = c.req.header(VISITOR_HEADER) ?? 'direct';
    const addressHash = createHmac('sha256', settings!.board_guest_key).update(address).digest('hex');
    if (await c.env.db.prepare('SELECT 1 FROM board_guest_blocks WHERE secret_hash = ?1 UNION ALL SELECT 1 FROM board_guest_address_blocks WHERE address_hash = ?2 AND until > ?3 LIMIT 1').bind(sha256Hex(secret), addressHash, Date.now()).first()) return fail(c, 403, 'guest-board-blocked');
    c.set('boardGuest', { addressHash });
  }
  return next();
});

// A guest's hash and an account's UUID inhabit disjoint namespaces; '' matches neither, including departed authors.
type Reader = Pick<Account, 'id' | 'admin' | 'suspended'>;
const GUEST_SECRET = /^[0-9a-f]{64}$/;
const guestSecret = (c: Context<AppEnv>) => {
  const secret = c.req.header(GUEST_BOARD_HEADER);
  return secret && GUEST_SECRET.test(secret) ? secret : null;
};
const readerOf = (c: Context<AppEnv>): Reader & { guest: boolean } => {
  const account: Account | undefined = c.get('account');
  const secret = guestSecret(c);
  return account ? { ...account, guest: false } : { id: secret ? sha256Hex(secret) : '', admin: false, suspended: false, guest: true };
};
const owns = (alias: string, identity = '?1') => `(${alias}.account_id = ${identity} OR (${alias}.account_id IS NULL AND ${alias}.guest_secret_hash = ${identity}))`;

const MAX_VERSION_LENGTH = 40;
const ROW_ID = /^[1-9]\d{0,15}$/;

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === 'string' && (list as readonly string[]).includes(value);
const idOf = (c: Context<AppEnv>) => (ROW_ID.test(c.req.param('id') ?? '') ? Number(c.req.param('id')) : null);

// Over a posts row aliased p: what the asker may read. The operator reads every post; a suspended account only its own
// operator-only ones; anyone else the public ones not hidden, and its own.
function readable(account: Reader) {
  if (account.admin) return 'TRUE';
  if (account.suspended) return `(${owns('p')} AND p.visibility = 'operator')`;
  return `(${owns('p')} OR (p.visibility = 'public' AND NOT ${hidden('p')}))`;
}
const commentShown = (account: Reader) => (account.admin ? 'TRUE' : `(${owns('c')} OR NOT ${hidden('c')})`);

const GUEST_NAME = (hash: string) => `'손님#' || substr(${hash}, 1, 4)`;
const AUTHOR = (a: string) =>
  `${owns(a)} AS mine, ${a}.account_id = ${OPERATOR} AS byOperator, (${a}.account_id IS NULL AND ${a}.guest_secret_hash IS NULL) AS gone,
   ${a}.guest_secret_hash IS NOT NULL AS guest, CASE WHEN ${a}.guest_secret_hash IS NOT NULL THEN ${GUEST_NAME(`${a}.guest_secret_hash`)} ELSE (SELECT name FROM board_names WHERE account_id = ${a}.account_id) END AS name`;
type AuthorSql = { mine: number | null; byOperator: number | null; gone: number; name: string | null; guest: number };
const author = (row: AuthorSql): Author => ({ name: row.byOperator ? OPERATOR_NAME : row.name, operator: Boolean(row.byOperator), mine: Boolean(row.mine), left: Boolean(row.gone), ...(row.guest ? { guest: true } : {}) });

type HiddenSql = { hiddenReason: string | null; hiddenUntil: number | null; hiddenNow: number };
const HIDDEN = (a: string) => `${a}.hidden_reason AS hiddenReason, ${a}.hidden_until AS hiddenUntil, ${hidden(a)} AS hiddenNow`;
// Its author and the operator see why a post or comment is hidden; others see no reason.
const hiddenOf = (row: HiddenSql, sees: boolean): Hidden | null => (row.hiddenNow && sees ? { reason: row.hiddenReason!, until: row.hiddenUntil } : null);

// A list shows the start of each post's text, a feed card's two lines at most.
const EXCERPT_LENGTH = 200;
const POST_COLUMNS = (account: Reader) => `p.id, p.title, substr(p.text, 1, ${EXCERPT_LENGTH}) AS excerpt, p.category, p.status, p.version, p.visibility, p.created_at AS createdAt, p.edited_at AS editedAt,
  p.locked, p.deleted, ${HIDDEN('p')}, ${AUTHOR('p')},
  (SELECT COUNT(*) FROM post_votes v WHERE v.post_id = p.id) AS votes,
  EXISTS (SELECT 1 FROM post_votes v WHERE v.post_id = p.id AND v.account_id = ?1) AS voted,
  (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted = 0 AND ${commentShown(account)}) AS commentCount`;
type PostSql = Omit<PostRow, 'author' | 'voted' | 'locked' | 'hidden' | 'deleted'> & AuthorSql & HiddenSql & { voted: number; locked: number; deleted: number };
const postRow = ({ mine, byOperator, gone, name, guest, hiddenReason, hiddenUntil, hiddenNow, voted, locked, deleted, ...row }: PostSql, account: Reader): PostRow => ({
  ...row,
  author: author({ mine, byOperator, gone, name, guest }),
  voted: Boolean(voted),
  locked: Boolean(locked),
  hidden: hiddenOf({ hiddenReason, hiddenUntil, hiddenNow }, account.admin || Boolean(mine)),
  deleted: Boolean(deleted),
});

const COMMENT_COLUMNS = `c.id, c.post_id AS postId, c.parent_id AS parentId, EXISTS (SELECT 1 FROM posts p WHERE p.id = c.post_id AND ((c.account_id IS NOT NULL AND c.account_id = p.account_id) OR (c.guest_secret_hash IS NOT NULL AND c.guest_secret_hash = p.guest_secret_hash))) AS byAuthor, c.text, c.created_at AS createdAt, c.edited_at AS editedAt, c.deleted, ${HIDDEN('c')}, ${AUTHOR('c')}`;
type CommentSql = Omit<Comment, 'author' | 'hidden' | 'deleted' | 'byAuthor'> & AuthorSql & HiddenSql & { deleted: number; byAuthor: number };
function comment({ mine, byOperator, gone, name, guest, hiddenReason, hiddenUntil, hiddenNow, deleted, text, byAuthor, ...row }: CommentSql, account: Reader): Comment {
  const sees = account.admin || Boolean(mine);
  return { ...row, byAuthor: Boolean(byAuthor), author: author({ mine, byOperator, gone, name, guest }), text: deleted || (hiddenNow && !sees) ? null : text, hidden: hiddenOf({ hiddenReason, hiddenUntil, hiddenNow }, sees), deleted: Boolean(deleted) };
}

const hasNickname = async (c: Context<AppEnv>) => (await c.env.db.prepare('SELECT 1 AS named FROM board_names WHERE account_id = ?').bind(c.get('account').id).first()) !== null;

board.get('/name', async (c) => {
  const account = c.get('account');
  if (account.admin) return c.json({ name: OPERATOR_NAME });
  return c.json({ name: await c.env.db.prepare('SELECT name FROM board_names WHERE account_id = ?').bind(account.id).first<string>('name') });
});

// The operator writes as OPERATOR_NAME and never holds a nickname, and nobody takes one that reads as it.
board.put('/name', async (c) => {
  const account = c.get('account');
  const name = (await readObject(c))?.name;
  if (account.admin) return fail(c, 400, 'bad-input');
  if (typeof name !== 'string' || !validNickname(name)) return fail(c, 400, 'bad-nickname');
  const key = nicknameKey(name);
  if (key === nicknameKey(OPERATOR_NAME)) return fail(c, 409, 'nickname-taken');
  const set = await c.env.db
    .prepare(
      `INSERT INTO board_names (account_id, name, name_key, changed_at) SELECT ?1, ?2, ?3, ?4 WHERE NOT EXISTS (SELECT 1 FROM board_names WHERE name_key = ?3 AND account_id != ?1)
       ON CONFLICT (account_id) DO UPDATE SET name = excluded.name, name_key = excluded.name_key, changed_at = excluded.changed_at RETURNING account_id`,
    )
    .bind(account.id, name, key, Date.now())
    .first();
  return set ? c.body(null, 204) : fail(c, 409, 'nickname-taken');
});

// mine: the asker's own posts of both visibilities, else one visibility, public when not asked. A 'top' page cursors on
// `${votes}:${id}` (contracts/board PostList), a 'new' one on id.
board.get('/posts', async (c) => {
  const account = readerOf(c);
  const sort = c.req.query('sort') ?? 'new';
  const category = c.req.query('category');
  const status = c.req.query('status');
  const visibility = c.req.query('visibility') ?? 'public';
  const mine = c.req.query('mine') === '1';
  const after = c.req.query('after');
  const limit = limitOf(c);
  const cursor = after === undefined ? null : (sort === 'top' ? /^(\d{1,15}):([1-9]\d{0,15})$/ : /^()([1-9]\d{0,15})$/).exec(after);
  if (
    !oneOf(SORTS, sort) || (category !== undefined && !oneOf(CATEGORIES, category)) || (status !== undefined && !oneOf(STATUSES, status)) ||
    !oneOf(['public', 'operator'], visibility) || limit === null || (after !== undefined && cursor === null)
  ) {
    return fail(c, 400, 'bad-input');
  }
  const values: SqlValue[] = [account.id];
  const bind = (value: SqlValue) => `?${values.push(value)}`;
  const where = [readable(account), mine ? owns('p') : `p.visibility = ${bind(visibility)}`];
  if (category !== undefined) where.push(`p.category = ${bind(category)}`);
  else if (!mine) where.push("p.category != 'news'");
  if (status !== undefined) where.push(`p.status = ${bind(status)}`);
  let next = 'TRUE';
  if (cursor) {
    const id = bind(Number(cursor[2]));
    const votes = sort === 'top' ? bind(Number(cursor[1])) : null;
    next = votes ? `(votes < ${votes} OR (votes = ${votes} AND id < ${id}))` : `id < ${id}`;
  }
  const { results } = await c.env.db
    .prepare(`SELECT * FROM (SELECT ${POST_COLUMNS(account)} FROM posts p WHERE ${where.join(' AND ')}) WHERE ${next} ORDER BY ${sort === 'top' ? 'votes DESC, ' : ''}id DESC LIMIT ${bind(limit)}`)
    .bind(...values)
    .all<PostSql>();
  const last = results.length === limit ? results.at(-1)! : null;
  return c.json({ posts: results.map((row) => postRow(row, account)), next: last && (sort === 'top' ? `${last.votes}:${last.id}` : String(last.id)) });
});

board.get('/posts/:id', async (c) => {
  const account = readerOf(c);
  const id = idOf(c);
  if (id === null) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const row = await db
    .prepare(`SELECT ${POST_COLUMNS(account)}, p.text, p.diagnostics, p.status_at AS statusAt, p.account_id AS accountId, (SELECT username FROM accounts WHERE id = p.account_id) AS username
      FROM posts p WHERE p.id = ?2 AND ${readable(account)}`)
    .bind(account.id, id)
    .first<PostSql & { text: string | null; diagnostics: string | null; statusAt: number | null; accountId: string | null; username: string | null }>();
  if (!row) return fail(c, 404, 'not-found');
  const { text, diagnostics, statusAt, accountId, username, ...shown } = row;
  const { results } = await db.prepare(`SELECT ${COMMENT_COLUMNS} FROM comments c WHERE c.post_id = ?2 ORDER BY c.id`).bind(account.id, id).all<CommentSql>();
  const { results: pictures } = await db.prepare('SELECT id, type FROM post_pictures WHERE post_id = ? ORDER BY id').bind(id).all<PostPicture>();
  const post: Post = {
    ...postRow(shown, account),
    text,
    pictures,
    statusAt,
    diagnostics: account.admin ? diagnostics : null,
    account: account.admin && username !== null ? { id: accountId!, username } : null,
    comments: results.map((each) => comment(each, account)),
  };
  return c.json({ post });
});

// 소식 is the operator's alone.
function readEdit(body: Record<string, unknown> | null, account: Reader) {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const text = body?.text;
  const category = body?.category;
  if (!title || title.length > MAX_TITLE_LENGTH || typeof text !== 'string' || text.length > MAX_POST_LENGTH || !oneOf(CATEGORIES, category)) return null;
  if (category === 'news' && !account.admin) return null;
  return { title, text, category };
}

// A suspended account writes only operator-only posts, since that is how it asks for its own deletion.
board.post('/posts', async (c) => {
  const account = readerOf(c);
  const body = await readObject(c);
  const edit = readEdit(body, account);
  const visibility = body?.visibility;
  const diagnostics = body?.diagnostics;
  const diagnosed = diagnostics === null || (visibility === 'operator' && typeof diagnostics === 'string' && diagnostics.length <= MAX_DIAGNOSTICS_LENGTH);
  if (!edit || !oneOf(['public', 'operator'], visibility) || !diagnosed || (edit.category === 'news' && visibility !== 'public')) return fail(c, 400, 'bad-input');
  if (account.suspended && visibility !== 'operator') return fail(c, 403, 'suspended');
  if (!account.guest && !account.admin && !(await hasNickname(c))) return fail(c, 403, 'no-nickname');
  // Never before its account was created, even if the wall clock went back: a restore's anchor reads that bound (lifecycle.ts).
  const id = await c.env.db
    .prepare(
      `INSERT INTO posts (account_id, title, text, category, visibility, diagnostics, created_at, guest_secret_hash, guest_address_hash)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, MAX(?7, COALESCE((SELECT created_at FROM accounts WHERE id = ?1), ?7)), ?9, ?10
       WHERE (?8 OR ${boardDailyLimit('posts', account.guest ? { secret: '?9', address: '?10' } : { account: '?1' }, '?7')}) RETURNING id`,
    )
    .bind(account.guest ? null : account.id, edit.title, edit.text, edit.category, visibility, diagnostics, Date.now(), account.admin ? 1 : 0,
      account.guest ? account.id : null, c.get('boardGuest')?.addressHash ?? null)
    .first<number>('id');
  return id === null ? fail(c, 429, 'too-many-posts') : c.json({ id });
});

// The author's alone: the operator hides or deletes another's post, never rewrites it.
board.put('/posts/:id', async (c) => {
  const account = readerOf(c);
  const id = idOf(c);
  const edit = readEdit(await readObject(c), account);
  if (id === null || !edit) return fail(c, 400, 'bad-input');
  const edited = await c.env.db
    .prepare(
      `UPDATE posts AS p SET title = ?3, text = ?4, category = ?5, edited_at = ?6
       WHERE p.id = ?2 AND ${owns('p')} AND p.deleted = 0 AND (?5 != 'news' OR p.visibility = 'public') AND ${readable(account)} RETURNING id`,
    )
    .bind(account.id, id, edit.title, edit.text, edit.category, Date.now())
    .first();
  return edited ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// The author's or the operator's. With comments it stays as a placeholder over them; without, it goes with its votes.
board.delete('/posts/:id', async (c) => {
  const account = readerOf(c);
  const id = idOf(c);
  if (id === null) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const own = `p.id = ?2 AND p.deleted = 0 AND (?3 OR ${owns('p')}) AND ${readable(account)}`;
  const bound = [account.id, id, account.admin ? 1 : 0];
  const done = await db.batch([
    ...(account.admin ? [db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, 'post-delete', id, json_object('title', title) FROM posts WHERE id = ?1 AND deleted = 0`).bind(id, Date.now())] : []),
    db.prepare(`DELETE FROM post_pictures WHERE post_id = ?2 AND EXISTS (SELECT 1 FROM posts p WHERE ${own})`).bind(...bound),
    db.prepare(`UPDATE posts AS p SET text = NULL, diagnostics = NULL, deleted = 1 WHERE ${own} AND EXISTS (SELECT 1 FROM comments WHERE post_id = p.id) RETURNING id`).bind(...bound),
    db.prepare(`DELETE FROM posts AS p WHERE ${own} AND NOT EXISTS (SELECT 1 FROM comments WHERE post_id = p.id) RETURNING id`).bind(...bound),
  ]);
  return done.slice(-2).some(({ results }) => results.length) ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// What the browser draws (runtime/picture postedPicture); nothing else is stored, whatever the request calls it.
function pictureType(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' ? 'image/webp' : null;
}

// GUEST_ROUTES leaves these behind the session: a guest can make a new secret freely, and pictures are unencrypted
// bytes the operator would be made to look at. The operator reads them, so public posts take none (ruled, design §6.13).
board.post('/posts/:id/pictures', async (c) => {
  const account = c.get('account');
  const id = idOf(c);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const type = pictureType(bytes);
  if (id === null || type === null) return fail(c, 400, 'bad-picture');
  if (account.suspended) return fail(c, 403, 'suspended');
  const db = c.env.db;
  const post = await db.prepare("SELECT 1 FROM posts WHERE id = ?1 AND account_id = ?2 AND visibility = 'operator' AND deleted = 0 AND locked = 0").bind(id, account.id).first();
  if (!post) return fail(c, 404, 'not-found');
  const added = await db
    .prepare(
      `INSERT INTO post_pictures (post_id, type, bytes, created_at) SELECT ?1, ?3, ?4, ?5
       WHERE (SELECT COUNT(*) FROM post_pictures WHERE post_id = ?1) < ${MAX_POST_PICTURES}
         AND (SELECT COUNT(*) FROM post_pictures x JOIN posts p ON p.id = x.post_id WHERE p.account_id = ?2 AND x.created_at > ?5 - ${DAY_MS}) < ${PICTURES_PER_DAY} RETURNING id`,
    )
    .bind(id, account.id, type, bytes, Date.now())
    .first<number>('id');
  return added === null ? fail(c, 429, 'too-many-pictures') : c.json({ id: added, type });
});

board.get('/posts/:id/pictures/:picture', async (c) => {
  const account = c.get('account');
  const id = idOf(c);
  const picture = c.req.param('picture');
  if (id === null || !ROW_ID.test(picture)) return fail(c, 400, 'bad-input');
  const row = await c.env.db
    .prepare(`SELECT x.bytes FROM post_pictures x JOIN posts p ON p.id = x.post_id WHERE x.id = ?3 AND p.id = ?2 AND ${readable(account)}`)
    .bind(account.id, id, Number(picture))
    .first<{ bytes: Uint8Array<ArrayBuffer> }>();
  // Never its image type: opened as a page, these bytes stay a download.
  return row ? c.body(row.bytes, 200, { 'content-type': 'application/octet-stream' }) : fail(c, 404, 'not-found');
});

// The author's alone; the operator deletes the post (with its log row) when a picture must go.
board.delete('/posts/:id/pictures/:picture', async (c) => {
  const id = idOf(c);
  const picture = c.req.param('picture');
  if (id === null || !ROW_ID.test(picture)) return fail(c, 400, 'bad-input');
  const removed = await c.env.db
    .prepare('DELETE FROM post_pictures WHERE id = ?3 AND post_id = ?2 AND EXISTS (SELECT 1 FROM posts p WHERE p.id = ?2 AND p.account_id = ?1) RETURNING id')
    .bind(c.get('account').id, id, Number(picture))
    .first();
  return removed ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// An operator-only post is a conversation with the operator, not a thing to recommend.
board.put('/posts/:id/vote', async (c) => {
  const account = c.get('account');
  const id = idOf(c);
  const voted = (await readObject(c))?.voted;
  if (id === null || typeof voted !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const visibility = await db.prepare(`SELECT p.visibility FROM posts p WHERE p.id = ?2 AND ${readable(account)}`).bind(account.id, id).first<string>('visibility');
  if (visibility === null) return fail(c, 404, 'not-found');
  if (visibility === 'operator') return fail(c, 400, 'bad-input');
  const [, counted] = await db.batch<{ votes: number }>([
    voted
      ? db.prepare('INSERT OR IGNORE INTO post_votes (post_id, account_id, created_at) SELECT id, ?1, ?3 FROM posts WHERE id = ?2').bind(account.id, id, Date.now())
      : db.prepare('DELETE FROM post_votes WHERE account_id = ?1 AND post_id = ?2').bind(account.id, id),
    db.prepare('SELECT COUNT(*) AS votes FROM post_votes WHERE post_id = ?').bind(id),
  ]);
  return c.json({ votes: counted!.results[0]!.votes });
});

const commentText = (value: unknown) => (typeof value === 'string' && value.trim() && value.length <= MAX_COMMENT_LENGTH ? value : null);

// Only post author/operator may comment, operator alone on news (user ruling); keep older third-party comments.
// Replies attach to the top-level thread. Operators bypass locks; private-post comments count as operator replies.
board.post('/posts/:id/comments', async (c) => {
  const account = readerOf(c);
  const id = idOf(c);
  const body = await readObject(c);
  const text = commentText(body?.text);
  const parentId = body?.parentId;
  if (id === null || text === null || !(parentId === null || positive(parentId))) return fail(c, 400, 'bad-input');
  if (!account.guest && !account.admin && !(await hasNickname(c))) return fail(c, 403, 'no-nickname');
  const db = c.env.db;
  const post = await db.prepare(`SELECT p.locked, COALESCE(p.account_id, p.guest_secret_hash) AS author FROM posts p WHERE p.id = ?2 AND p.deleted = 0 AND ${readable(account)}`).bind(account.id, id).first<{ locked: number; author: string | null }>();
  if (!post) return fail(c, 404, 'not-found');
  if (!account.admin && account.id !== post.author) return fail(c, 403, 'not-author');
  if (post.locked && !account.admin) return fail(c, 409, 'post-locked');
  const parent = parentId === null ? null : await db
    .prepare('SELECT COALESCE(c.parent_id, c.id) AS top FROM comments c WHERE c.id = ? AND c.post_id = ?')
    .bind(parentId, id)
    .first<number>('top');
  if (parentId !== null && parent === null) return fail(c, 400, 'bad-input');
  const added = await db
    .prepare(
      `INSERT INTO comments (post_id, parent_id, account_id, text, created_at, guest_secret_hash, guest_address_hash) SELECT ?2, ?3, ?1, ?4, ?5, ?7, ?8
       WHERE (?6 OR ${boardDailyLimit('comments', account.guest ? { secret: '?7', address: '?8' } : { account: '?1' }, '?5')}) RETURNING id`,
    )
    .bind(account.guest ? null : account.id, id, parent, text, Date.now(), account.admin ? 1 : 0,
      account.guest ? account.id : null, c.get('boardGuest')?.addressHash ?? null)
    .first<number>('id');
  if (added === null) return fail(c, 429, 'too-many-comments');
  const row = await db.prepare(`SELECT ${COMMENT_COLUMNS} FROM comments c WHERE c.id = ?2`).bind(account.id, added).first<CommentSql>();
  return c.json({ comment: comment(row!, account) });
});

board.put('/comments/:id', async (c) => {
  const account = readerOf(c);
  const id = idOf(c);
  const text = commentText((await readObject(c))?.text);
  if (id === null || text === null) return fail(c, 400, 'bad-input');
  const edited = await c.env.db
    .prepare(`UPDATE comments AS c SET text = ?3, edited_at = ?4 WHERE c.id = ?2 AND ${owns('c')} AND c.deleted = 0
      AND EXISTS (SELECT 1 FROM posts p WHERE p.id = c.post_id AND ${readable(account)}) RETURNING id`)
    .bind(account.id, id, text, Date.now())
    .first();
  return edited ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// The author's or the operator's. With 답글 it stays as a placeholder over them; a placeholder, of a comment or of its
// post, goes once nothing is left under it.
board.delete('/comments/:id', async (c) => {
  const account = readerOf(c);
  const id = idOf(c);
  if (id === null) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const post = await db
    .prepare(`SELECT c.post_id FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?2 AND c.deleted = 0 AND ${readable(account)}`)
    .bind(account.id, id)
    .first<number>('post_id');
  if (post === null) return fail(c, 404, 'not-found');
  const own = [id, account.admin ? 1 : 0, account.id];
  const done = await db.batch([
    ...(account.admin ? [db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, 'comment-delete', id, json_object('post', post_id) FROM comments WHERE id = ?1 AND deleted = 0`).bind(id, Date.now())] : []),
    db.prepare(`UPDATE comments AS c SET text = NULL, deleted = 1 WHERE c.id = ?1 AND c.deleted = 0 AND (?2 OR ${owns('c', '?3')}) AND EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id) RETURNING id`).bind(...own),
    db.prepare(`DELETE FROM comments AS c WHERE c.id = ?1 AND c.deleted = 0 AND (?2 OR ${owns('c', '?3')}) AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id) RETURNING id`).bind(...own),
    db.prepare('DELETE FROM comments AS c WHERE c.post_id = ? AND c.deleted = 1 AND NOT EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id)').bind(post),
    db.prepare('DELETE FROM posts AS p WHERE p.id = ? AND p.deleted = 1 AND NOT EXISTS (SELECT 1 FROM comments WHERE post_id = p.id)').bind(post),
  ]);
  return done.slice(-4, -2).some(({ results }) => results.length) ? c.body(null, 204) : fail(c, 404, 'not-found');
});

// 신고, into the operator's inbox beside share reports (admin.ts): one open report per reporter and target.
async function report(c: Context<AppEnv>, target: (account: Reader) => string) {
  const account = c.get('account');
  const id = idOf(c);
  const text = (await readObject(c))?.text;
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (id === null || !trimmed || trimmed.length > MAX_REPORT_LENGTH) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const reported = await db.prepare(target(account)).bind(account.id, id).first<{ post: number; comment: number | null }>();
  if (!reported) return fail(c, 404, 'not-found');
  const open = await db.prepare('SELECT 1 AS open FROM reports WHERE account_id = ? AND post_id = ? AND comment_id IS ? AND resolved_at IS NULL').bind(account.id, reported.post, reported.comment).first();
  if (open) return c.body(null, 204);
  const sent = await db
    .prepare(
      `INSERT INTO reports (account_id, username, text, created_at, post_id, comment_id) SELECT id, username, ?2, ?3, ?4, ?5 FROM accounts
       WHERE id = ?1 AND (SELECT COUNT(*) FROM reports WHERE account_id = ?1 AND share IS NULL AND resolved_at IS NULL) < ?6 RETURNING id`,
    )
    .bind(account.id, trimmed, Date.now(), reported.post, reported.comment, MAX_OPEN_REPORTS)
    .first();
  return sent ? c.body(null, 204) : fail(c, 429, 'too-many-reports');
}

board.post('/posts/:id/reports', (c) => report(c, (account) => `SELECT p.id AS post, NULL AS comment FROM posts p WHERE p.id = ?2 AND p.deleted = 0 AND ${readable(account)}`));
board.post('/comments/:id/reports', (c) =>
  report(c, (account) => `SELECT p.id AS post, c.id AS comment FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = ?2 AND c.deleted = 0 AND ${readable(account)}`),
);

// Newest first; the cursor is `${at}:${id}` of the last row shown, since rows of one time are ordered by id.
board.get('/activity', async (c) => {
  const account = c.get('account');
  const after = c.req.query('after');
  const limit = limitOf(c);
  const cursor = after === undefined ? null : /^(\d{1,15}):([1-9]\d{0,15})$/.exec(after);
  if (limit === null || (after !== undefined && cursor === null)) return fail(c, 400, 'bad-input');
  const { results } = await c.env.db
    .prepare(
      `SELECT a.id, a.kind, a.postId, a.title, a.at, a.commentId, a.status, a.byId = ${OPERATOR} AS byOperator, (a.byId IS NULL AND NOT EXISTS (SELECT 1 FROM comments WHERE id = a.commentId AND guest_secret_hash IS NOT NULL)) AS gone,
       EXISTS (SELECT 1 FROM comments WHERE id = a.commentId AND guest_secret_hash IS NOT NULL) AS guest,
       CASE WHEN a.byId IS NULL THEN (SELECT ${GUEST_NAME('guest_secret_hash')} FROM comments WHERE id = a.commentId) ELSE (SELECT name FROM board_names WHERE account_id = a.byId) END AS name FROM (${activity('?1')}) a
       WHERE ?2 IS NULL OR (a.at, a.id) < (?2, ?3) ORDER BY a.at DESC, a.id DESC LIMIT ?4`,
    )
    .bind(account.id, cursor ? Number(cursor[1]) : null, cursor ? Number(cursor[2]) : null, limit)
    .all<Omit<Activity, 'by'> & { byOperator: number | null; gone: number; name: string | null; guest: number }>();
  const last = results.length === limit ? results.at(-1)! : null;
  return c.json({
    activity: results.map(({ byOperator, gone, name, guest, ...row }): Activity => ({ ...row, by: author({ mine: 0, byOperator, gone, name, guest }) })),
    next: last && `${last.at}:${last.id}`,
  });
});

// id: the newest activity the page showed; it and everything before it are seen, so one that came since stays unread.
board.post('/seen', async (c) => {
  const account = c.get('account');
  const id = (await readObject(c))?.id;
  if (!positive(id)) return fail(c, 400, 'bad-input');
  await c.env.db
    .prepare(`UPDATE accounts SET board_seen = MAX(board_seen, COALESCE((SELECT at FROM (${activity('?1')}) WHERE id = ?2), 0)) WHERE id = ?1`)
    .bind(account.id, id)
    .run();
  await tellUnread(c);
  return c.body(null, 204);
});

// The operator's moves, each in one batch with its admin_log row, written only if its target is there (admin.ts act).
const operator = createMiddleware<AppEnv>(async (c, next) => (c.get('account').admin ? next() : fail(c, 403, 'not-admin')));

board.put('/posts/:id/status', operator, async (c) => {
  const id = idOf(c);
  const body = await readObject(c);
  const status = body?.status;
  const version = body?.version;
  const named = version === null || (status === 'done' && typeof version === 'string' && version.trim() !== '' && version.length <= MAX_VERSION_LENGTH);
  if (id === null || !oneOf(STATUSES, status) || !named) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const values = [id, Date.now(), status, version === null ? null : version.trim()];
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, 'post-status', id, json_object('status', ?3, 'version', ?4) FROM posts WHERE id = ?1 AND category != 'news'`).bind(...values),
    db.prepare("UPDATE posts SET status = ?3, version = ?4, status_at = ?2 WHERE id = ?1 AND category != 'news' RETURNING id").bind(...values),
  );
});

// hidden: a reason and a hold of days (임시조치), or days null for hidden until shown; null shows it again.
function readHidden(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { reason, days } = value as Record<string, unknown>;
  const why = typeof reason === 'string' ? reason.trim() : '';
  const held = days === null || (positive(days) && days <= HOLD_DAYS_MAX);
  return why && why.length <= MAX_REASON_LENGTH && held ? { reason: why, days: days as number | null } : undefined;
}

const hide = (table: 'posts' | 'comments', kind: 'post' | 'comment') => async (c: Context<AppEnv>) => {
  const id = idOf(c);
  const shown = readHidden((await readObject(c))?.hidden);
  if (id === null || shown === undefined) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const now = Date.now();
  if (shown === null) {
    return act(
      c,
      db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, '${kind}-show', id FROM ${table} WHERE id = ?1`).bind(id, now),
      db.prepare(`UPDATE ${table} SET hidden_reason = NULL, hidden_until = NULL WHERE id = ? RETURNING id`).bind(id),
    );
  }
  // 임시조치 tells the author (정보통신망법 제44조의2): a notice from the operator naming the post, the reason and the hold's end.
  const told = `'"' || p.title || '" ${table === 'posts' ? '글을' : '글에 쓴 댓글을'} 가렸어요. 이유: ' || ?3 || '.' || CASE WHEN ?4 IS NULL THEN '' ELSE ' ' || CAST(?4 AS INTEGER) || '일 뒤에 다시 보여요.' END`;
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target, detail) SELECT ?2, '${kind}-hide', id, json_object('reason', ?3, 'days', ?4) FROM ${table} WHERE id = ?1`).bind(id, now, shown.reason, shown.days),
    db
      .prepare(
        `INSERT INTO notices (incarnation, text, created_at) SELECT a.incarnation, ${told}, ?2 FROM ${table} t JOIN posts p ON p.id = ${table === 'posts' ? 't.id' : 't.post_id'}
         JOIN accounts a ON a.id = t.account_id WHERE t.id = ?1 AND t.account_id IS NOT ${OPERATOR}`,
      )
      .bind(id, now, shown.reason, shown.days),
    db.prepare(`UPDATE ${table} SET hidden_reason = ?2, hidden_until = ?3 WHERE id = ?1 RETURNING id`).bind(id, shown.reason, shown.days === null ? null : now + shown.days * DAY_MS),
  );
};

board.put('/posts/:id/hidden', operator, hide('posts', 'post'));
board.put('/comments/:id/hidden', operator, hide('comments', 'comment'));

board.put('/posts/:id/locked', operator, async (c) => {
  const id = idOf(c);
  const locked = (await readObject(c))?.locked;
  if (id === null || typeof locked !== 'boolean') return fail(c, 400, 'bad-input');
  const db = c.env.db;
  return act(
    c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, ?3, id FROM posts WHERE id = ?1`).bind(id, Date.now(), locked ? 'post-lock' : 'post-unlock'),
    db.prepare('UPDATE posts SET locked = ?2 WHERE id = ?1 RETURNING id').bind(id, locked ? 1 : 0),
  );
});

// Retrying a cut-off conversion is harmless: claimed rows no longer carry the guest hash.
board.post('/claim', async (c) => {
  const secret = (await readObject(c))?.secret;
  if (typeof secret !== 'string' || !GUEST_SECRET.test(secret)) return fail(c, 400, 'bad-input');
  await c.env.db.batch(['posts', 'comments'].map((table) => c.env.db.prepare(
    `UPDATE ${table} SET account_id = ?1, guest_secret_hash = NULL, guest_address_hash = NULL WHERE guest_secret_hash = ?2`,
  ).bind(c.get('account').id, sha256Hex(secret))));
  return c.body(null, 204);
});

const blockGuest = (table: 'posts' | 'comments') => async (c: Context<AppEnv>) => {
  const id = idOf(c);
  if (id === null) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const now = Date.now();
  return act(c,
    db.prepare(`INSERT INTO admin_log (at, action, target) SELECT ?2, 'guest-block', id FROM ${table} WHERE id = ?1 AND guest_secret_hash IS NOT NULL`).bind(id, now),
    db.prepare(`INSERT INTO board_guest_address_blocks (address_hash, until) SELECT guest_address_hash, ?2 FROM ${table} WHERE id = ?1 AND guest_address_hash IS NOT NULL ON CONFLICT (address_hash) DO UPDATE SET until = excluded.until`).bind(id, now + DAY_MS),
    db.prepare(`INSERT INTO board_guest_blocks (secret_hash) SELECT guest_secret_hash FROM ${table} WHERE id = ? AND guest_secret_hash IS NOT NULL ON CONFLICT (secret_hash) DO UPDATE SET secret_hash = excluded.secret_hash RETURNING secret_hash`).bind(id),
  );
};
board.put('/posts/:id/guest-block', operator, blockGuest('posts'));
board.put('/comments/:id/guest-block', operator, blockGuest('comments'));
