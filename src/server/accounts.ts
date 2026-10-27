import { randomBytes } from 'node:crypto';
import { Hono, type Context } from 'hono';
import type { Door } from '../contracts/accounts';
import type { RestoreAction } from '../contracts/admin';
import { CAP } from './caps';
import { checkProof, findAccount, hashProof, outsideVisitor, readMethod, readProof } from './credentials';
import { fail, ID, readObject, type Account, type AppEnv } from './http';
import { answerAction, answerBegin, leaveAccount, refuseLeft, restoreFrom, restorePoints, restoresOf, store } from './lifecycle';
import { canWrite, currentAccount, dropSessionCookie, endOtherSessions, endSession, requireOwnSession, requireSession, setSessionCookie, startSession } from './session';
import { insertVault, readVault, readWrap } from './vaults';
import { UNREAD_BOARD, UNREAD_NOTICES } from './unread';

const USERNAME = /^[\p{L}\p{N}_.-]{2,32}$/u;
const ROOM = '(SELECT COUNT(*) FROM accounts) < (SELECT signup_cap FROM service)';

export const accounts = new Hono<AppEnv>();

// Prepare file before atomically inserting account/vault/session and first-operator claim.
// Client must download recovery key first; interrupted signup may leave an orphan file, never an account without one.
accounts.post('/signup', async (c) => {
  const visitor = outsideVisitor(c);
  if (visitor && !c.env.limits.visitors.signups.limit(visitor).success) return fail(c, 429, 'too-many-signups');
  const body = await readObject(c);
  const accountId = typeof body?.accountId === 'string' && ID.test(body.accountId) ? body.accountId : null;
  const passwordProof = readProof(body?.passwordProof);
  const recoveryProof = readProof(body?.recoveryProof);
  const passwordWrap = readWrap(body?.passwordWrap);
  const recoveryWrap = readWrap(body?.recoveryWrap);
  if (!accountId || typeof body?.username !== 'string' || !passwordProof || !recoveryProof || !passwordWrap || !recoveryWrap) {
    return fail(c, 400, 'bad-input');
  }
  // The password salt comes from the username as the client wrote it, so any other form is refused, not fixed.
  const username = body.username;
  if (!USERNAME.test(username) || username !== username.normalize('NFC').toLowerCase()) return fail(c, 400, 'bad-username');
  const db = c.env.db;

  const incarnation = randomBytes(16).toString('hex');
  const timeline = randomBytes(16).toString('hex');
  const [session, loginHash, recoveryHash] = await Promise.all([startSession(db, accountId, true), hashProof(passwordProof), hashProof(recoveryProof)]);
  const now = Date.now();
  // Insert checks username/cap atomically; changes() gates vault/session/claim, never a stale pre-read.
  // Hold file creation + batch against generation capture so backups get both or neither.
  const [created, , , claim, room] = await c.env.backups.hold(async () => {
    await c.env.stores.prepare(incarnation, timeline);
    return db.batch<{ incarnation?: string; open?: number }>([
      db
        .prepare(
          `INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline) SELECT ?1, ?2, ?3, ?4, ?5, ?6
           WHERE ${ROOM} AND NOT EXISTS (SELECT 1 FROM accounts WHERE id = ?1 OR username = ?2) RETURNING incarnation`,
        )
        .bind(accountId, username, loginHash, now, incarnation, timeline),
      insertVault(db, accountId, { passwordWrap, recoveryWrap, recoveryHash }, now),
      session.insert,
      db.prepare('UPDATE installation SET operator_account = ? WHERE id = 1 AND operator_account IS NULL AND changes() = 1').bind(accountId),
      db.prepare(`SELECT ${ROOM} AS open`),
    ]);
  });
  if (!created!.results.length) return room!.results[0]!.open ? fail(c, 409, 'username-taken') : fail(c, 403, 'signup-closed');
  setSessionCookie(c, session.token);
  return c.json(await describe(c, { id: accountId, username, suspended: false, incarnation, state: 'active', admin: claim!.meta.changes === 1 }), 201);
});

// Answers like GET /session, so the client opens the vault without another request.
accounts.post('/login', async (c) => {
  const visitor = outsideVisitor(c);
  if (visitor) {
    const { success, retryAfter } = c.env.limits.visitors.logins.limit(visitor);
    if (!success) return fail(c, 429, 'too-many-attempts', { retryAfter });
  }
  const body = await readObject(c);
  const method = readMethod(body?.method);
  const proof = readProof(body?.proof);
  if (typeof body?.username !== 'string' || !USERNAME.test(body.username) || !method || !proof) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const account = await findAccount(db, 'username', body.username);
  const wrong = await checkProof(c, body.username, account, method, proof);
  if (wrong) return wrong;
  if (!account) return fail(c, 401, 'wrong-login');
  if (account.state === 'leaving') return fail(c, 403, 'account-leaving');

  const started = await startSession(db, account.id);
  await started.insert.run();
  setSessionCookie(c, started.token);
  const [session, vault] = await Promise.all([describe(c, { ...account, suspended: account.suspended_at !== null, admin: account.admin === 1 }), readVault(db, account.id)]);
  return c.json({ session, vault });
});

accounts.post('/logout', async (c) => {
  await endSession(c);
  return c.body(null, 204);
});

// No proof asked: a stolen session can only make the owner sign in again, and a new password ends it (vaults.ts).
accounts.post('/logout/others', requireSession, async (c) => {
  const { meta } = await endOtherSessions(c).run();
  return c.json({ ended: meta.changes });
});

// The door only tells the first screen which form to show; the signup insert decides. solo names the one account, since
// that installation's sign-in asks for no username.
async function door(c: Context<AppEnv>): Promise<Door> {
  const { cap, accounts, username } = (await c.env.db
    .prepare('SELECT signup_cap AS cap, (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT username FROM accounts LIMIT 1) AS username FROM service')
    .first<{ cap: number; accounts: number; username: string | null }>())!;
  if (cap === 1 && accounts === 0) return { kind: 'setup' };
  if (cap === 1 && accounts === 1) return { kind: 'solo', username: username! };
  return { kind: accounts < cap ? 'open' : 'full' };
}

// Everything a page load needs, in one request: from Korea each round trip can take seconds.
accounts.get('/session', async (c) => {
  const account = await currentAccount(c);
  if (!account) return c.json({ session: null, door: await door(c) });
  // For 헤이젤 나우's page-load mark (worker.ts), which counts the signed-in account.
  c.set('account', account);
  const [session, vault] = await Promise.all([describe(c, account), readVault(c.env.db, account.id)]);
  return c.json({ session, vault });
});

// Re-prove identity for deletion; stolen sessions cannot delete. Admit leaving accounts to resume interrupted cleanup.
// Retain reports/posts/operator logs with departed authors. The sole operator cannot leave.
accounts.delete('/account', requireOwnSession, async (c) => {
  const body = await readObject(c);
  const method = readMethod(body?.method);
  const proof = readProof(body?.proof);
  if (!method || !proof) return fail(c, 400, 'bad-input');
  const { id, incarnation } = c.get('account');
  const wrong = await checkProof(c, c.get('account').username, await findAccount(c.env.db, 'id', id), method, proof);
  if (wrong) return wrong;
  const left = await leaveAccount(c.env, c.executionCtx, id, incarnation, false);
  if (left !== 'left') return refuseLeft(c, left);
  dropSessionCookie(c);
  return c.body(null, 204);
});

// Self-restore needs no new proof because undo remains available for RETENTION_MS.
// Suspended accounts cannot begin one but may finish an existing operation.
accounts.post('/account/restores', requireSession, canWrite, async (c) => {
  const from = restoreFrom(await readObject(c));
  if (!from) return fail(c, 400, 'bad-input');
  return answerBegin(c, c.get('account').id, null, from);
});

accounts.get('/account/points', requireSession, async (c) => c.json({ points: (await restorePoints(c.env.db, c.get('account').id))! }));

accounts.get('/account/restores', requireSession, async (c) => c.json({ restores: await restoresOf(c.env.db, c.get('account').id) }));

// Only the account's own restores, whoever began them: one the operator began is the account's too.
accounts.post('/account/restores/:id/:action{resume|finalize|cancel}', requireSession, async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id < 1) return fail(c, 400, 'bad-input');
  const own = await c.env.db.prepare('SELECT 1 FROM restores WHERE id = ? AND incarnation = ?').bind(id, c.get('account').incarnation).first();
  if (!own) return fail(c, 404, 'not-found');
  return answerAction(c, id, c.req.param('action') as RestoreAction);
});

// Return account id for vault AAD. Null caps mean unlimited; null bytes means the store is unavailable/restoring.
async function describe(c: Context<AppEnv>, account: Pick<Account, 'id' | 'username' | 'suspended' | 'incarnation' | 'state' | 'admin'>) {
  const { incarnation } = account;
  const [usage, facts] = await Promise.all([
    store(c.env, incarnation).usage(incarnation),
    c.env.db.prepare(
      `SELECT ${CAP.bytes} AS bytesCap, file_bytes AS fileBytes, ${CAP.fileBytes} AS fileBytesCap,
         ${UNREAD_NOTICES} AS unreadNotices, ${UNREAD_BOARD} AS unreadBoard
       FROM accounts WHERE incarnation = ?`,
    )
      .bind(incarnation)
      .first<{ bytesCap: number | null; fileBytes: number; fileBytesCap: number | null; unreadNotices: number; unreadBoard: number }>(),
  ]);
  const { unreadNotices, unreadBoard, ...storage } = facts!;
  return {
    accountId: account.id,
    username: account.username,
    admin: account.admin,
    suspended: account.suspended,
    state: account.state,
    incarnation,
    storage: { bytes: 'bytes' in usage ? usage.bytes : null, ...storage },
    unreadNotices,
    unreadBoard,
    localProviders: [...c.env.localProviders],
  };
}
