import type { Context } from 'hono';
import { UNREAD_BOARD_HEADER, UNREAD_NOTICES_HEADER } from '../contracts/http';
import type { AppEnv } from './http';

// What counts as unread for an account: the operator's notices (admin.ts) and what happened on the board to what it
// wrote (board.ts). The lists and these counts read the same SQL text.

export const OPERATOR = '(SELECT operator_account FROM installation)';

// Over a posts or comments row aliased a: the operator hid it and no hold on it has run out.
export const hidden = (a: string) => `(${a}.hidden_reason IS NOT NULL AND (${a}.hidden_until IS NULL OR ${a}.hidden_until > unixepoch('subsec') * 1000))`;

// The notices an account reads, over a notices row and an accounts row (both unaliased): its own, and those to every
// account sent at or after it was created.
export const VISIBLE = '(notices.incarnation = accounts.incarnation OR (notices.incarnation IS NULL AND notices.created_at >= accounts.created_at))';
// Over an accounts row.
export const UNREAD_NOTICES = `(SELECT COUNT(*) FROM notices WHERE ${VISIBLE} AND notices.id > accounts.notices_seen)`;

// Derive activity from comments/status, never duplicate stored counters.
// Disjoint ids: comment id * 2, status post id * 2 + 1.
// Suspended accounts hear only readable operator-only activity; SQL a names the account.
const OPENABLE = (a: string) => `(p.visibility = 'operator' OR (SELECT s.suspended_at FROM accounts s WHERE s.id = ${a}) IS NULL)`;
const HEARD = (a: string) => `c.account_id IS NOT ${a} AND c.deleted = 0 AND NOT ${hidden('c')}
    AND (p.account_id = ${a} OR ${a} IS ${OPERATOR} OR NOT ${hidden('p')}) AND ${OPENABLE(a)}`;
// The comments on its posts, and the replies to its comments under posts not its own: two halves that share no row, each
// led by an index (posts_account, comments_account). One WHERE over both reads every comment there is.
const ON_MINE = (a: string) => `FROM posts p JOIN comments c ON c.post_id = p.id LEFT JOIN comments parent ON parent.id = c.parent_id
  WHERE p.account_id = ${a} AND ${HEARD(a)}`;
const UNDER_MINE = (a: string) => `FROM comments parent JOIN comments c ON c.parent_id = parent.id JOIN posts p ON p.id = c.post_id
  WHERE parent.account_id = ${a} AND p.account_id IS NOT ${a} AND ${HEARD(a)}`;
const STATUSED = (a: string) => `FROM posts p WHERE p.account_id = ${a} AND p.status_at IS NOT NULL AND ${a} IS NOT ${OPERATOR} AND ${OPENABLE(a)}`;

const COMMENT = (a: string) => `SELECT c.id * 2 AS id, CASE WHEN parent.account_id IS ${a} THEN 'reply' ELSE 'comment' END AS kind, p.id AS postId, p.title, c.account_id AS byId,
     c.created_at AS at, c.id AS commentId, NULL AS status`;
export const activity = (a: string) =>
  `${COMMENT(a)} ${ON_MINE(a)}
   UNION ALL
   ${COMMENT(a)} ${UNDER_MINE(a)}
   UNION ALL
   SELECT p.id * 2 + 1, 'status', p.id, p.title, ${OPERATOR}, p.status_at, NULL, p.status ${STATUSED(a)}`;

// Over an accounts row.
export const UNREAD_BOARD = `((SELECT COUNT(*) ${ON_MINE('accounts.id')} AND c.created_at > accounts.board_seen)
  + (SELECT COUNT(*) ${UNDER_MINE('accounts.id')} AND c.created_at > accounts.board_seen)
  + (SELECT COUNT(*) ${STATUSED('accounts.id')} AND p.status_at > accounts.board_seen))`;

export async function tellUnread(c: Context<AppEnv>) {
  const unread = await c.env.db
    .prepare(`SELECT ${UNREAD_NOTICES} AS notices, ${UNREAD_BOARD} AS board FROM accounts WHERE incarnation = ?`)
    .bind(c.get('account').incarnation)
    .first<{ notices: number; board: number }>();
  if (!unread) return;
  c.header(UNREAD_NOTICES_HEADER, String(unread.notices));
  c.header(UNREAD_BOARD_HEADER, String(unread.board));
}
