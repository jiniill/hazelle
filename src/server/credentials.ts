import type { Context } from 'hono';
import type { AccountState } from '../contracts/admin';
import { VISITOR_HEADER } from '../contracts/http';
import type { Db } from './db/service-db';
import { fail, sha256Hex, type AppEnv } from './http';

export type Method = 'password' | 'recovery';
type StoredAccount = {
  id: string;
  username: string;
  login_hash: string;
  admin: number;
  recovery_hash: string;
  suspended_at: number | null;
  incarnation: string;
  state: AccountState;
};

// 256 bits in base64: what the client derives from the password or the recovery key.
const PROOF = /^[A-Za-z0-9+/]{43}=$/;

export function readProof(value: unknown): string | null {
  return typeof value === 'string' && PROOF.test(value) ? value : null;
}

export function readMethod(value: unknown): Method | null {
  return value === 'password' || value === 'recovery' ? value : null;
}

// A plain hash is enough: guessing a password from a stolen hash still costs the client's Argon2id per guess.
export const hashProof = sha256Hex;

export function findAccount(db: Db, column: 'id' | 'username', value: string) {
  return db
    .prepare(
      `SELECT a.id, a.username, a.login_hash, v.recovery_hash, a.suspended_at, a.incarnation, a.state,
         a.id = (SELECT operator_account FROM installation) AS admin
       FROM accounts a JOIN vaults v ON v.account_id = a.id WHERE a.${column} = ?`,
    )
    .bind(value)
    .first<StoredAccount>();
}

// Skip in-process/loopback requests. External visitors come only from the socket peer or trusted proxy,
// never a client-supplied key (frontend-worker.ts).
const LOCAL = /^(?:127\.|::1$|::ffff:127\.)/;

export function outsideVisitor(c: Context<AppEnv>): string | null {
  const visitor = c.req.header(VISITOR_HEADER);
  return visitor && !LOCAL.test(visitor) ? visitor : null;
}

// Password change and deletion share the login's visitor+username key, not a session key a new login could bypass.
export async function checkProof(c: Context<AppEnv>, username: string, account: StoredAccount | null, method: Method, proof: string): Promise<Response | null> {
  const hash = hashProof(proof);
  const valid = account !== null && sameText(hash, method === 'password' ? account.login_hash : account.recovery_hash);
  const visitor = outsideVisitor(c);
  const retryAfter = visitor ? c.env.limits.visitors.proofs.check(visitor, username, valid) : 0;
  if (retryAfter) return fail(c, 429, 'too-many-attempts', { retryAfter });
  return valid ? null : fail(c, 401, 'wrong-login');
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
