import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionContext } from 'hono';
import { ACCOUNT_HEADER } from '../contracts/http';
import { serviceReads } from './account-store';
import { alerts } from './alerts';
import { backups } from './backup/backups';
import { accountRegistry } from './db/account-db';
import { migrate } from './db/migrate';
import { openDatabase, serviceDb } from './db/service-db';
import { diskBucket } from './files/disk-bucket';
import { sha256Hex, type Services } from './http';
import { relayBudget, tokenBucket, uploadBudget, visitorLimits } from './limits';
import { openPulse } from './pulse';
import { reconcile } from './reconcile';
import type { Upstream } from './relay';
import { streamRegistry } from './stream-registry';
import { streamStore } from './db/streams-db';
import app from './worker';

// The server in process over the production adapters on a temp directory (node.ts builds the same Services on /data).
// upstream answers the provider calls the relay and the streams make. clock stamps the stores' snapshots.
export async function testApp(upstream: Upstream = () => Promise.reject(new TypeError('This test gave the streams no upstream.')), relay = relayBudget()) {
  const dir = mkdtempSync(join(tmpdir(), 'hazelle-test-'));
  const raw = openDatabase(join(dir, 'service.sqlite'));
  migrate(raw, 'migrations');
  const db = serviceDb(raw);
  const clock = { now: () => Date.now() };
  const registry = () => accountRegistry(dir, db, serviceReads(db), () => clock.now(), env.files);
  const disk = { freePercent: 50 };
  const outbound: Upstream = (url, init) => upstream(url, init);
  const files = diskBucket(dir);
  const limits = { relay, calls: tokenBucket(240), botCalls: tokenBucket(20), visitors: visitorLimits(), uploads: uploadBudget() };
  const env: Services = {
    db,
    files,
    stores: accountRegistry(dir, db, serviceReads(db), () => clock.now(), files),
    streams: streamRegistry(streamStore(join(dir, 'streams.sqlite')), outbound, limits.relay),
    outbound,
    localProviders: new Set(),
    limits,
    backups: backups(dir, 3, alerts('https://alerts.test/hook'), async () => disk.freePercent),
    pulse: openPulse(db, () => clock.now()),
  };

  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (work: Promise<unknown>) => void pending.push(work), passThroughOnException: () => {}, props: {} } as ExecutionContext;
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };

  // As a page holding the cookie's account sends it: stating that account (server/session) and the body's length, as
  // fetch does. raw states only what it is given. A Uint8Array body goes as bytes.
  const holding = async (cookie: string): Promise<Record<string, string>> => {
    const account = await env.db.prepare('SELECT account_id FROM sessions WHERE token_hash = ?').bind(await sha256Hex(cookie.split('=')[1]!)).first<string>('account_id');
    return account ? { cookie, [ACCOUNT_HEADER]: account } : { cookie };
  };
  const send = async (method: string, path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => {
    const bytes = body instanceof Uint8Array;
    const sent = body === undefined ? undefined : bytes ? (body as Uint8Array<ArrayBuffer>) : new TextEncoder().encode(JSON.stringify(body));
    return app.request(
      `/api/${path}`,
      {
        method,
        headers: {
          ...(method === 'GET' ? {} : { 'content-type': bytes ? 'application/octet-stream' : 'application/json' }),
          ...(sent && { 'content-length': String(sent.byteLength) }),
          ...(cookie ? await holding(cookie) : {}),
          ...headers,
        },
        body: sent,
      },
      env,
      ctx,
    );
  };
  const timeline = async (cookie: string) => ((await (await send('GET', 'objects?since=0', undefined, cookie)).json()) as { timeline: string }).timeline;

  return {
    env,
    dir,
    clock,
    disk,
    get stores() {
      return env.stores;
    },
    dispose: () => {
      env.stores.close();
      env.streams.close();
      raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
    reset: async () => {
      await settle();
      await env.streams.expire(Number.MAX_SAFE_INTEGER);
      clock.now = () => Date.now();
      env.stores.close();
      await env.db.batch([
        ...['visit_hashes', 'visit_keys', 'visit_days'].map((table) => env.db.prepare(`DELETE FROM ${table}`)),
        ...['share_files', 'share_versions', 'shares', 'file_blocks', 'restores', 'account_files', 'notices', 'post_votes', 'board_guest_blocks', 'board_guest_address_blocks', 'comments', 'posts', 'board_names', 'vaults', 'sessions', 'accounts', 'reports', 'admin_log', 'snapshots', 'picture_removals', 'snapshot_removals', 'backup_runs', 'alerts_sent', 'pulse_week', 'pulse_week_roles', 'pulse_week_models', 'pulse_week_below', 'pulse_day_places', 'pulse_hours', 'pulse_seen', 'pulse_used', 'pulse_replies', 'pulse_guest_seen', 'pulse_guest_used', 'pulse_guest_replies'].map((table) => env.db.prepare(`DELETE FROM ${table}`)),
        env.db.prepare('UPDATE installation SET operator_account = NULL'),
        env.db.prepare('UPDATE service SET signup_cap = 1, account_bytes_cap = NULL, account_file_bytes_cap = NULL, pulse_guests = 1, pulse_closed = 0, board_guests = 1'),
      ]);
      for (const sub of ['accounts', 'files', 'snapshots', 'backup']) rmSync(join(dir, sub), { recursive: true, force: true });
      env.stores = registry();
      env.pulse = openPulse(env.db, () => clock.now());
    },
    get: (path: string, cookie?: string, headers?: Record<string, string>) => send('GET', path, undefined, cookie, headers),
    post: (path: string, body?: unknown, cookie?: string, headers?: Record<string, string>) => send('POST', path, body, cookie, headers),
    put: (path: string, body?: unknown, cookie?: string) => send('PUT', path, body, cookie),
    delete: (path: string, body?: unknown, cookie?: string) => send('DELETE', path, body, cookie),
    raw: (path: string, init: RequestInit) => app.request(`/api/${path}`, init, env, ctx),
    settle,
    timeline,
    signUp: async (username = `u${crypto.randomUUID().slice(0, 8)}`, accountId: string = crypto.randomUUID()) => {
      const body = { ...signupBody(username), accountId };
      const cookie = sessionCookie(await send('POST', 'signup', body));
      const { incarnation, timeline } = (await env.db.prepare('SELECT incarnation, timeline FROM accounts WHERE id = ?').bind(accountId).first<{ incarnation: string; timeline: string }>())!;
      return { id: accountId, body, cookie, incarnation, timeline };
    },
    // An operator-only 게시판 post by the account, as one asking the operator for a restore writes (server/board).
    askOperator: async (accountId: string) =>
      (await env.db
        .prepare(`INSERT INTO posts (account_id, title, text, category, visibility, created_at) SELECT id, 'restore', 'restore', 'question', 'operator', MAX(?2, created_at) FROM accounts WHERE id = ?1 RETURNING id`)
        .bind(accountId, Date.now())
        .first<number>('id'))!,
    reconcile: (now = Date.now()) => reconcile(dir, env.db, env.files, now),
    // The account's row changed in the service, then its store restarted, as every lifecycle change is made
    // (server/lifecycle).
    lifecycle: async (accountId: string, set: string) => {
      const incarnation = await env.db.prepare(`UPDATE accounts SET ${set} WHERE id = ? RETURNING incarnation`).bind(accountId).first<string>('incarnation');
      await env.stores.getByName(incarnation!).restart(incarnation!).catch(() => {});
    },
    batch: async (writes: unknown[], cookie: string, files: string[] = []) => send('POST', 'objects/batch', { timeline: await timeline(cookie), writes, files }, cookie),
    // The daily job at a time, with the stores' clock set to it so the baselines it takes carry that time.
    daily: async (now: number) => {
      clock.now = () => now;
      return env.backups.daily(env, now);
    },
    // The registry as a new process would start it over the same directory: every open account file closed, nothing
    // remembered. The service connection and the other services stay as they are.
    restartProcess: () => {
      env.stores.close();
      env.stores = registry();
    },
    // 헤이젤 나우 as a new process opens it: nothing remembered.
    restartPulse: () => {
      env.pulse = openPulse(env.db, () => clock.now());
    },
  };
}

export const sessionCookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

// A proof as the client would send it: 32 bytes in base64. The server never learns how it was derived.
export const proof = (seed: string) => btoa(seed.repeat(32).slice(0, 32));

export const signupBody = (username = 'jin') => ({
  accountId: crypto.randomUUID(),
  username,
  passwordProof: proof('password'),
  recoveryProof: proof('recovery'),
  passwordWrap: 'cGFzc3dvcmQgd3JhcA==',
  recoveryWrap: 'cmVjb3Zlcnkgd3JhcA==',
});

// A stream's reply key as the client makes it (vault/streams.ts).
export async function replyKey() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const key = btoa(String.fromCharCode(...new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)));
  return { pair, key };
}
