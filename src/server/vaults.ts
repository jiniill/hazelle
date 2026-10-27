import { Hono } from 'hono';
import { checkProof, findAccount, hashProof, readMethod, readProof } from './credentials';
import type { Db } from './db/service-db';
import { fail, readObject, type AppEnv } from './http';
import { endOtherSessions, requireSession } from './session';

// The server stores the wrapped keys without understanding them. The cap only keeps rows small: a real wrap is 80
// characters.
const MAX_WRAP_LENGTH = 1024;

export const vaults = new Hono<AppEnv>();

vaults.use(requireSession);

// No GET route here: GET /api/session and POST /api/login carry the record.
export async function readVault(db: Db, accountId: string) {
  const row = await db
    .prepare('SELECT password_wrap, recovery_wrap FROM vaults WHERE account_id = ?')
    .bind(accountId)
    .first<{ password_wrap: string; recovery_wrap: string }>();
  return row && { passwordWrap: row.password_wrap, recoveryWrap: row.recovery_wrap };
}

// Written only if the statement before it in the batch wrote a row: signup's account.
export function insertVault(db: Db, accountId: string, vault: { passwordWrap: string; recoveryWrap: string; recoveryHash: string }, now: number) {
  return db
    .prepare('INSERT INTO vaults (account_id, password_wrap, recovery_wrap, recovery_hash, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
    .bind(accountId, vault.passwordWrap, vault.recoveryWrap, vault.recoveryHash, now, now);
}

export function readWrap(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_WRAP_LENGTH ? value : null;
}

// Atomically replace login hash/password wrap and revoke other sessions.
// Require password/recovery proof so a stolen session cannot lock out the owner.
vaults.put('/password', async (c) => {
  const body = await readObject(c);
  const method = readMethod(body?.method);
  const proof = readProof(body?.proof);
  const passwordProof = readProof(body?.passwordProof);
  const passwordWrap = readWrap(body?.passwordWrap);
  if (!method || !proof || !passwordProof || !passwordWrap) return fail(c, 400, 'bad-input');
  const db = c.env.db;
  const id = c.get('account').id;
  const refused = await checkProof(c, c.get('account').username, await findAccount(db, 'id', id), method, proof);
  if (refused) return refused;

  await db.batch([
    db.prepare('UPDATE accounts SET login_hash = ? WHERE id = ?').bind(hashProof(passwordProof), id),
    db.prepare('UPDATE vaults SET password_wrap = ?, updated_at = ? WHERE account_id = ?').bind(passwordWrap, Date.now(), id),
    endOtherSessions(c),
  ]);
  return c.body(null, 204);
});
