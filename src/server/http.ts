import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AccountState } from '../contracts/admin';
import { VISITOR_HEADER, type ServerError } from '../contracts/http';
import type { PulseLabel } from '../contracts/pulse';
import { isRecord } from '../record';
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

// Production/tests build the same Services. outbound owns provider access; localProviders is also sent in sessions.
// Limits distinguish accounts, bot chats, anonymous visitors and credential/signup attempts.
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
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
const KST = 9 * HOUR_MS;
// The start of `at`'s day in Korea, where the operator reads the daily counts.
export const visitDay = (at: number) => Math.floor((at + KST) / DAY_MS) * DAY_MS - KST;

// A leaving or gone account answers as a signed-out one: its session is over.
export function refused(c: Context, answer: Refused) {
  if ('unavailable' in answer) return fail(c, 503, 'store-unavailable', { retryAfter: RETRY_SECONDS });
  return answer.refused === 'restoring' ? fail(c, 503, 'account-restoring', { retryAfter: RETRY_SECONDS }) : fail(c, 401, 'no-session');
}

// The anonymous routes count per visitor, as the public listener saw them (VISITOR_HEADER). A request that did not
// come through it, as in tests, counts as one visitor.
export const visitorOf = (c: Context) => c.req.header(VISITOR_HEADER) ?? 'direct';

export const countVisit = (kind: 'reads' | 'files' | 'reports') =>
  createMiddleware<AppEnv>(async (c, next) => (c.env.limits.visitors[kind].limit(visitorOf(c)).success ? next() : fail(c, 429, 'too-many-visits')));

export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

export const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const isPositive = (value: unknown): value is number => isCount(value) && value > 0;

export async function readObject(c: Context): Promise<Record<string, unknown> | null> {
  const body: unknown = await c.req.json().catch(() => null);
  return isRecord(body) ? body : null;
}

// A list's page size: PAGE_ROWS unless the query asks for fewer; null for one it may not ask for.
const PAGE_ROWS = 100;
export function limitOf(c: Context) {
  const limit = c.req.query('limit');
  if (limit === undefined) return PAGE_ROWS;
  return /^[1-9]\d{0,2}$/.test(limit) && Number(limit) <= PAGE_ROWS ? Number(limit) : null;
}
