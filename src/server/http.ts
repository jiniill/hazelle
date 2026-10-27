import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AccountState } from '../contracts/admin';
import type { ServerError } from '../contracts/http';
import type { PulseLabel } from '../contracts/pulse';
import type { Refused } from './account-store';
import type { Backups } from './backup/backups';
import type { Stores } from './db/account-db';
import type { Db } from './db/service-db';
import type { Bucket } from './files/bucket';
import type { Limiter, RelayBudget, UploadBudget, visitorLimits } from './limits';
import type { Pulse } from './pulse';
import type { Upstream } from './relay';
import type { Streams } from './stream-registry';

// incarnation: the server-made id of the account's data (migrations/0001_baseline.sql). bytesCap: the cap as this
// request's session read it, null for none. admin: the installation row names this account as the operator.
export type Account = { id: string; username: string; suspended: boolean; incarnation: string; state: AccountState; bytesCap: number | null; admin: boolean };
// Account and object ids are UUIDs made by the client.
export const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// What the process gives every request (node.ts; testing.ts builds the same set over a temp directory). outbound: the
// one way a provider is reached; localProviders: the hosts it reaches outside the public internet (outbound.ts), which
// the session tells the client. limits: calls per account, botCalls per account and chat, visitors per visitor on the
// anonymous share routes (shares.ts), signup and credentials. backups: the daily job. pulse: 헤이젤 나우's counts.
export type Services = {
  db: Db;
  files: Bucket;
  stores: Stores;
  streams: Streams;
  outbound: Upstream;
  localProviders: ReadonlySet<string>;
  limits: { relay: RelayBudget; calls: Limiter; botCalls: Limiter; visitors: ReturnType<typeof visitorLimits>; uploads: UploadBudget };
  backups: Backups;
  pulse: Pulse;
};

// label: the request's 헤이젤 나우 label (worker.ts).
export type AppEnv = { Bindings: Services; Variables: { account: Account; storeMs?: number; label?: PulseLabel; boardGuest?: { addressHash: string } } };

export function fail(c: Context, status: ContentfulStatusCode, error: ServerError, detail: Record<string, unknown> = {}) {
  return c.json({ error, ...detail }, status);
}

export const RETRY_SECONDS = 5;
export const DAY_MS = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;
// The start of `at`'s day in Korea, where the operator reads the daily counts.
export const visitDay = (at: number) => Math.floor((at + KST) / DAY_MS) * DAY_MS - KST;

// A leaving or gone account answers as a signed-out one: its session is over.
export function refused(c: Context, answer: Refused) {
  if ('unavailable' in answer) return fail(c, 503, 'store-unavailable', { retryAfter: RETRY_SECONDS });
  return answer.refused === 'restoring' ? fail(c, 503, 'account-restoring', { retryAfter: RETRY_SECONDS }) : fail(c, 401, 'no-session');
}

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export async function readObject(c: Context): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return isRecord(body) ? body : null;
}
