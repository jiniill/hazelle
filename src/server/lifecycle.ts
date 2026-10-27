import type { Context, ExecutionContext } from 'hono';
import { BEFORE_ARMED, SELF_RESTORES_PER_DAY, type RestoreAction, type RestoreError, type RestorePhase, type SnapshotKind } from '../contracts/admin';
import type { Life, Unavailable } from './account-store';
import { landing, RETENTION_MS } from './db/account-db';
import type { Db } from './db/service-db';
import { DAY_MS, fail, refused, type AppEnv, type Services } from './http';
import { removePictures } from './reconcile';
import { takeBackFiles } from './files/claims';

// Lifecycle stays on the service row, outside store rewind: write it, restart the store, then verify what loaded.
// Any await may be interrupted and retried: service writes use compare-and-set; store calls must be repeatable.
// Every statement names the incarnation so old runners cannot touch a recreated account with the same id.

const MINUTE_MS = 60_000;
// A restore asks for a time at least this far back, so the snapshot chosen for it lies before the restore's own mark.
const NEWEST_MS = 10 * MINUTE_MS;
// Snapshots are kept for RETENTION_MS (db/account-db.ts). A day less leaves an operation time to choose its target, which
// is pinned from then on (backup/snapshots.ts), so nothing expires between choosing it and installing it.
const OLDEST_MS = RETENTION_MS - DAY_MS;
// Restarts that did not apply the armed rewind before the operation stops and waits for the operator.
const ARM_TRIES = 3;
// Steps one run takes before it stops: every phase once, the re-arms, and the compare-and-sets a parallel run won.
const MAX_STEPS = 24;

// A fresh stub per call: a stub got before a restart fails every later call.
export const store = (env: Services, incarnation: string) => env.stores.getByName(incarnation);

// Restart deliberately throws; verify completion through a fresh stub.
const restart = (env: Services, incarnation: string) =>
  store(env, incarnation)
    .restart(incarnation)
    .catch(() => {});

async function reload(env: Services, incarnation: string): Promise<Life | Unavailable> {
  await restart(env, incarnation);
  return store(env, incarnation).status(incarnation);
}

// left: the account's row is deleted, by this run or an earlier one. Its pictures are removed after the answer.
// operator: the account is the installation's only operator, which neither path may delete.
export type Left = 'left' | 'busy' | 'unavailable' | 'operator';

// Every change below runs inside a backup hold (backup/backups.ts), so a generation never captures one half done.
export function leaveAccount(
  env: Services,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  accountId: string,
  incarnation: string,
  operator: boolean,
): Promise<Left> {
  return env.backups.hold(() => leave(env, ctx, accountId, incarnation, operator));
}

export function refuseLeft(c: Context, left: Exclude<Left, 'left'>): Response {
  switch (left) {
    case 'busy':
      return fail(c, 409, 'account-busy');
    case 'operator':
      return fail(c, 403, 'sole-operator');
    case 'unavailable':
      return refused(c, { unavailable: true });
  }
}

async function leave(
  env: Services,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  accountId: string,
  incarnation: string,
  operator: boolean,
): Promise<Left> {
  const db = env.db;
  // The operator's log row is written with the intent, before anything is destroyed.
  const [intent] = await db.batch([
    db
      .prepare("UPDATE accounts SET state = 'leaving' WHERE id = ? AND incarnation = ? AND state = 'active' AND id IS NOT (SELECT operator_account FROM installation)")
      .bind(accountId, incarnation),
    ...(operator
      ? [
          db
            .prepare("INSERT INTO admin_log (at, action, target, detail) SELECT ?, 'delete-account', id, json_object('username', username) FROM accounts WHERE incarnation = ? AND changes() = 1")
            .bind(Date.now(), incarnation),
        ]
      : []),
  ]);
  if (!intent!.meta.changes) {
    const row = await db
      .prepare('SELECT state, id = (SELECT operator_account FROM installation) AS operator FROM accounts WHERE id = ? AND incarnation = ?')
      .bind(accountId, incarnation)
      .first<{ state: string; operator: number }>();
    if (row === null) return 'left';
    if (row.operator) return 'operator';
    if (row.state !== 'leaving') return 'busy';
  }
  env.backups.depart(accountId, incarnation, Date.now());
  const life = await reload(env, incarnation);
  // The row goes only after the store was seen fenced and emptied. A restart that never reached the store leaves it
  // answering as it was, and deleting the row then would leave its objects behind with nothing left to name them.
  if ('unavailable' in life || (life.state !== 'leaving' && life.state !== 'gone')) return 'unavailable';
  if (life.state === 'leaving') {
    const destroyed = await store(env, incarnation).destroy(incarnation);
    if ('unavailable' in destroyed) return 'unavailable';
  }
  // The pictures follow the row: whatever a cut-off removal or an upload still in flight leaves under the incarnation
  // is the hourly reconciliation's (reconcile.ts), and no later run of this has to find it.
  await db.prepare("DELETE FROM accounts WHERE id = ? AND incarnation = ? AND state = 'leaving'").bind(accountId, incarnation).run();
  ctx.waitUntil(removePictures(env.files, db, incarnation, Date.now()));
  return 'left';
}

export type Run = { id: number; phase: RestorePhase; verified: boolean; error: string | null };

type Operation = {
  id: number;
  incarnation: string;
  at: number | null;
  undoes: number | null;
  timeline: string;
  target: string | null;
  phase: RestorePhase;
  verified: number;
  error: string | null;
};

// Shared restore-eligibility SQL for insertion and refusal explanation. accounts row is unaliased;
// ?1 account, ?2 private post (null for self), ?3 time, ?4 undo operation, ?5 now.
const FREE = "accounts.state = 'active' AND NOT EXISTS (SELECT 1 FROM restores WHERE incarnation = accounts.incarnation AND verified = 0)";
// The operator begins one on an operator-only post (board.ts) the account wrote and the operator has not settled. Only
// the account's own route passes no post (accounts.ts); the operator's always names one.
const ON_POST = `(?2 IS NULL OR EXISTS (SELECT 1 FROM posts WHERE id = ?2 AND account_id = accounts.id AND visibility = 'operator'
  AND status NOT IN ('done', 'declined') AND deleted = 0 AND created_at >= accounts.created_at))`;
// Counted by the checkpoints taken (SELF_RESTORES_PER_DAY): a restore stopped before one cost no disk.
const WITHIN_LIMIT = `(?2 IS NOT NULL OR (SELECT COUNT(*) FROM restores WHERE incarnation = accounts.incarnation AND report_id IS NULL
   AND checkpoint IS NOT NULL AND created_at > ?5 - ${DAY_MS}) < ${SELF_RESTORES_PER_DAY})`;
const TIMELY = `?3 BETWEEN ?5 - ${OLDEST_MS} AND ?5 - ${NEWEST_MS}`;
// An undo rewinds the account's latest finished restore to its checkpoint while the checkpoint is pinned
// (backup/snapshots.ts): for RETENTION_MS after the restore ended.
export const undoable = (operation: string, now: string) =>
  `${operation} = (SELECT id FROM restores WHERE incarnation = accounts.incarnation AND phase = 'done' AND verified = 1 ORDER BY id DESC LIMIT 1)
   AND (SELECT ended_at FROM restores WHERE id = ${operation}) > ${now} - ${RETENTION_MS}`;

type Begun = { begun: number } | { refused: 'not-found' | 'account-busy' | 'bad-post' | 'too-many-restores' | 'bad-time' | 'cannot-undo' };

// The operation's row and the account's hold on it commit together or not at all: the hold is gated on the insert.
// An undo's target, the undone restore's checkpoint, is recorded with the row, so it is pinned from the begin on.
export async function beginRestore(env: Services, accountId: string, post: number | null, from: { at: number } | { undoes: number }): Promise<Begun> {
  const db = env.db;
  const at = 'at' in from ? from.at : null;
  const undoes = 'undoes' in from ? from.undoes : null;
  const now = Date.now();
  const [inserted] = await env.backups.hold(() => db.batch<{ id: number }>([
    db
      .prepare(
        `INSERT INTO restores (incarnation, report_id, at, undoes, target, timeline, phase, created_at, updated_at)
         SELECT incarnation, ?2, ?3, ?4, (SELECT checkpoint FROM restores WHERE id = ?4), lower(hex(randomblob(16))), 'begun', ?5, ?5 FROM accounts
         WHERE id = ?1 AND ${FREE} AND ${ON_POST} AND ${WITHIN_LIMIT} AND (${TIMELY} OR ${undoable('?4', '?5')}) RETURNING id`,
      )
      .bind(accountId, post, at, undoes, now),
    db
      .prepare(
        `UPDATE accounts SET state = 'restoring', operation = (SELECT MAX(id) FROM restores WHERE incarnation = accounts.incarnation AND phase = 'begun')
         WHERE id = ? AND state = 'active' AND changes() = 1`,
      )
      .bind(accountId),
    db
      .prepare(
        `INSERT INTO admin_log (at, action, target, detail)
         SELECT ?1, 'restore-begun', id, json_object('username', username, 'operation', operation, 'post', ?2, 'at', ?3, 'undoes', ?4)
         FROM accounts WHERE id = ?5 AND state = 'restoring' AND changes() = 1`,
      )
      .bind(now, post, at, undoes, accountId),
  ]));
  const id = inserted!.results[0]?.id;
  if (id !== undefined) return { begun: id };
  const why = await db
    .prepare(`SELECT ${FREE} AS free, ${ON_POST} AS onPost, ${WITHIN_LIMIT} AS within FROM accounts WHERE id = ?1`)
    .bind(accountId, post, null, null, now)
    .first<{ free: number; onPost: number; within: number }>();
  if (!why) return { refused: 'not-found' };
  if (!why.free) return { refused: 'account-busy' };
  if (!why.onPost) return { refused: 'bad-post' };
  if (!why.within) return { refused: 'too-many-restores' };
  return { refused: at === null ? 'cannot-undo' : 'bad-time' };
}

// null: no such operation.
// Every step re-reads the operation, so a run that lost a compare-and-set to a parallel run follows where it went.
export async function runRestore(env: Services, id: number): Promise<Run | null> {
  let arms = 0;
  for (let steps = 0; ; steps++) {
    const stepped = await env.backups.hold(async () => {
      const operation = await readOperation(env.db, id);
      if (!operation) return null;
      const stop = steps === MAX_STEPS ? 'stuck' : await step(env, operation, () => ++arms > ARM_TRIES);
      if (typeof stop === 'string') {
        await env.db.prepare("UPDATE restores SET error = ?, updated_at = ? WHERE id = ? AND phase = ? AND phase != 'failed'").bind(stop, Date.now(), id, operation.phase).run();
      }
      return { stop };
    });
    if (!stepped) return null;
    if (stepped.stop === undefined) continue;
    const end = await readOperation(env.db, id);
    return end && run(end);
  }
}

// Gives the account back with its timeline unchanged, possible only before the rewind is armed. too-late: armed or
// later, from where an operation only goes forward.
export async function cancelRestore(env: Services, id: number): Promise<Run | null | 'too-late'> {
  const cancelled = await env.backups.hold(async () => {
    const operation = await readOperation(env.db, id);
    if (!operation) return null;
    if (operation.phase !== 'cancelled' && !(await release(env, operation, 'cancelled', BEFORE_ARMED, null))) {
      const now = await readOperation(env.db, id);
      if (!now) return null;
      if (now.phase !== 'cancelled') return 'too-late' as const;
    }
    return 'cancelled' as const;
  });
  return cancelled === 'cancelled' ? runRestore(env, id) : cancelled;
}

// undefined: go on from the re-read operation. null: stop, nothing to record. A string: stop with this error code.
async function step(env: Services, operation: Operation, armedTooOften: () => boolean): Promise<RestoreError | null | undefined> {
  const { id, incarnation } = operation;
  const db = env.db;
  switch (operation.phase) {
    case 'begun': {
      // The fence: from the restart on, the store refuses every feed and batch.
      const life = await reload(env, incarnation);
      if ('unavailable' in life) return 'store-unavailable';
      if (life.state === 'restoring' && life.operation === id) await advance(db, id, 'begun', 'fenced');
      return undefined;
    }
    case 'fenced': {
      // Nothing writes the store while it is fenced, so a parallel run's checkpoint names the same state. The first
      // one written stays.
      const answer = await store(env, incarnation).checkpoint(incarnation, id);
      if ('unavailable' in answer) return 'store-unavailable';
      if ('checkpoint' in answer) await advance(db, id, 'fenced', 'checkpointed', 'checkpoint = ?, checkpoint_at = ?', answer.checkpoint, Date.now());
      return undefined;
    }
    case 'checkpointed': {
      const answer = await store(env, incarnation).target(incarnation, id, operation.undoes === null ? { at: operation.at! } : { snapshot: operation.target! });
      if ('unavailable' in answer) return 'store-unavailable';
      if ('tooEarly' in answer) await release(env, operation, 'failed', ['checkpointed'], 'too-early');
      if (!('target' in answer)) return undefined;
      // The mark is the operation's own key, written after the target's time: present after a restart, the rewind has
      // not applied yet.
      const marked = await store(env, incarnation).mark(incarnation, id);
      if ('unavailable' in marked) return 'store-unavailable';
      if ('marked' in marked) await advance(db, id, 'checkpointed', 'targeted', 'target = ?', answer.target);
      return undefined;
    }
    case 'targeted':
      await advance(db, id, 'targeted', 'armed');
      return undefined;
    case 'armed': {
      const answer = await store(env, incarnation).marked(incarnation, id);
      if ('unavailable' in answer) return 'store-unavailable';
      if (!('marked' in answer)) return undefined;
      // The rewind applied only if this operation installed the file from the target and the mark written after it is
      // gone; either alone proves nothing.
      if (!answer.marked && answer.installedFrom === operation.target && answer.installedOp === id) {
        await advance(db, id, 'armed', 'rewound');
        return undefined;
      }
      // Arming the one target again is harmless: nothing writes the store between a rewind and the finish.
      if (armedTooOften()) return 'not-rewound';
      const armed = await store(env, incarnation).arm(incarnation, id, operation.target!);
      if ('unavailable' in armed) return 'store-unavailable';
      if ('returned' in armed) {
        await db.prepare("UPDATE restores SET returned = ? WHERE id = ? AND phase = 'armed' AND returned IS NULL").bind(armed.returned, id).run();
        await restart(env, incarnation);
      }
      return undefined;
    }
    case 'rewound': {
      // The target's objects may name pictures released since it was taken; their bytes are still kept (reconcile.ts).
      await db.batch([
        db.prepare("UPDATE restores SET phase = 'done', error = NULL, updated_at = ?1, ended_at = ?1 WHERE id = ?2 AND phase = 'rewound'").bind(Date.now(), id),
        db
          .prepare("UPDATE accounts SET state = 'active', timeline = ?, operation = NULL WHERE incarnation = ? AND operation = ? AND state = 'restoring' AND changes() = 1")
          .bind(operation.timeline, incarnation, id),
        terminalLog(db, 'restore-done', operation, null),
        ...takeBackFiles(db, incarnation, { snapshot: operation.target! }),
      ]);
      return undefined;
    }
    default: {
      // done, cancelled or failed: the store must be seen loading the account as the service left it, or it would keep refusing
      // as restoring for as long as clients keep it awake.
      if (operation.verified) return null;
      const life = await reload(env, incarnation);
      if ('unavailable' in life) return 'store-unavailable';
      if (life.state !== 'active' || (operation.phase === 'done' && life.timeline !== operation.timeline)) return 'not-verified';
      if (operation.phase !== 'done') {
        const unmarked = await store(env, incarnation).unmark(incarnation, id);
        if ('unavailable' in unmarked) return 'store-unavailable';
      }
      await db
        .prepare("UPDATE restores SET verified = 1, error = CASE WHEN phase = 'failed' THEN error END, updated_at = ? WHERE id = ? AND phase = ?")
        .bind(Date.now(), id, operation.phase)
        .run();
      return undefined;
    }
  }
}

function advance(db: Db, id: number, from: RestorePhase, to: RestorePhase, set?: string, ...binds: (string | number)[]) {
  return db
    .prepare(`UPDATE restores SET phase = ?, error = NULL, updated_at = ?${set ? `, ${set}` : ''} WHERE id = ? AND phase = ?`)
    .bind(to, Date.now(), ...binds, id, from)
    .run();
}

// true: this run ended it.
async function release(env: Services, operation: Operation, to: 'cancelled' | 'failed', from: RestorePhase[], error: RestoreError | null) {
  const db = env.db;
  const [ended] = await db.batch([
    db
      .prepare(`UPDATE restores SET phase = ?1, error = ?2, updated_at = ?3, ended_at = ?3 WHERE id = ?4 AND phase IN (SELECT value FROM json_each(?5))`)
      .bind(to, error, Date.now(), operation.id, JSON.stringify(from)),
    db.prepare("UPDATE accounts SET state = 'active', operation = NULL WHERE incarnation = ? AND operation = ? AND state = 'restoring' AND changes() = 1").bind(operation.incarnation, operation.id),
    terminalLog(db, to === 'cancelled' ? 'restore-cancelled' : 'restore-failed', operation, error),
  ]);
  return ended!.meta.changes === 1;
}

// Written once per operation: gated on the account's release, which only the run that won the terminal phase makes.
function terminalLog(db: Db, action: string, operation: Operation, error: RestoreError | null) {
  return db
    .prepare(
      `INSERT INTO admin_log (at, action, target, detail)
       SELECT ?, ?, id, json_object('username', username, 'operation', ?, 'undoes', ?, 'error', ?) FROM accounts WHERE incarnation = ? AND changes() = 1`,
    )
    .bind(Date.now(), action, operation.id, operation.undoes, error, operation.incarnation);
}

function readOperation(db: Db, id: number) {
  return db.prepare('SELECT id, incarnation, at, undoes, timeline, target, phase, verified, error FROM restores WHERE id = ?').bind(id)
    .first<Operation>();
}

function run({ id, phase, verified, error }: Pick<Operation, 'id' | 'phase' | 'verified' | 'error'>): Run {
  return { id, phase, verified: Boolean(verified), error };
}

function restoreActions(phase: RestorePhase, verified: boolean): RestoreAction[] {
  if (phase === 'done' || phase === 'cancelled' || phase === 'failed') return verified ? [] : ['finalize'];
  return BEFORE_ARMED.includes(phase) ? ['resume', 'cancel'] : ['resume'];
}

// The operator's routes (admin.ts) and the account's own (accounts.ts) answer restores alike; each checks who may act.

// A new restore asks for a time or an undo, never both; null for neither.
export function restoreFrom(body: Record<string, unknown> | null): { at: number } | { undoes: number } | null {
  const at = body?.at;
  const undoes = body?.undoes;
  const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
  if (at === undefined) return whole(undoes) && undoes > 0 ? { undoes } : null;
  return undoes === undefined && whole(at) && at >= 0 ? { at } : null;
}

const REFUSAL_STATUS = { 'not-found': 404, 'account-busy': 409, 'bad-post': 400, 'too-many-restores': 429, 'bad-time': 400, 'cannot-undo': 400 } as const;

// The operation runs in this request.
export async function answerBegin(c: Context<AppEnv>, accountId: string, post: number | null, from: { at: number } | { undoes: number }) {
  const begun = await beginRestore(c.env, accountId, post, from);
  if ('refused' in begun) return fail(c, REFUSAL_STATUS[begun.refused], begun.refused);
  return c.json(await runRestore(c.env, begun.begun));
}

// Offer snapshots inside the request window plus the older baseline covering its oldest edge.
// Ask slightly inside that edge so the point remains available while the user decides.
const EDGE_MS = 15 * MINUTE_MS;
export async function restorePoints(db: Db, accountId: string, now = Date.now()) {
  const incarnation = await db.prepare('SELECT incarnation FROM accounts WHERE id = ?').bind(accountId).first<string>('incarnation');
  if (incarnation === null) return null;
  const { results } = await db
    .prepare('SELECT taken_at AS takenAt, kind FROM snapshots WHERE incarnation = ? AND taken_at BETWEEN ? AND ? GROUP BY taken_at ORDER BY taken_at DESC')
    .bind(incarnation, now - OLDEST_MS, now - NEWEST_MS)
    .all<{ takenAt: number; kind: SnapshotKind }>();
  const points = results.map(({ takenAt, kind }) => ({ at: takenAt, takenAt, kind }));
  const edge = now - OLDEST_MS + EDGE_MS;
  const older = await landing(db, incarnation, edge);
  if (older && older.takenAt < now - OLDEST_MS) points.push({ at: edge, takenAt: older.takenAt, kind: older.kind });
  return points;
}

// Newest first. targetAt: when the snapshot it rewinds to was taken, null until it is chosen. report_id is the shipped column
// name (migration 0005) for the operator-only post a restore answers.
export async function restoresOf(db: Db, accountId: string) {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.report_id AS postId, r.at, r.undoes, r.phase, r.verified, r.error, r.created_at AS createdAt, r.updated_at AS updatedAt,
         (SELECT taken_at FROM snapshots WHERE id = r.target) AS targetAt, r.ended_at, ${undoable('r.id', '?2')} AS canUndo
       FROM restores r JOIN accounts ON accounts.incarnation = r.incarnation WHERE accounts.id = ?1 ORDER BY r.id DESC`,
    )
    .bind(accountId, Date.now())
    .all<{ phase: RestorePhase; verified: number; canUndo: number; ended_at: number | null }>();
  return results.map(({ ended_at, canUndo, ...row }) => ({
    ...row,
    verified: Boolean(row.verified),
    canUndo: Boolean(canUndo),
    undoExpiresAt: canUndo ? ended_at! + RETENTION_MS : null,
    actions: restoreActions(row.phase, Boolean(row.verified)),
  }));
}

// Resume and finalize both run the operation on from its phase: they are retries of it.
export async function answerAction(c: Context<AppEnv>, id: number, action: RestoreAction) {
  const ran = action === 'cancel' ? await cancelRestore(c.env, id) : await runRestore(c.env, id);
  if (ran === 'too-late') return fail(c, 409, 'cannot-cancel');
  return ran ? c.json(ran) : fail(c, 404, 'not-found');
}
