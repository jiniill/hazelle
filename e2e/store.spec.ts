import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROW_BYTES } from '../src/server/caps';
import { startServer, stopServer } from './helpers';

// Use a separate built-server data directory so restart/crash tests can inspect actual account files and pictures.

type Write = { id: string; kind: string; parent: string | null; body: string | null; baseRev: number | null };
type FeedPage = { timeline: string; changes: { id: string; rev: number; body?: string | null }[]; cursor: number; until: number; more: boolean };
type Actor = { accountId: string; cookie: string };
type Account = Actor & {
  incarnation: string;
  username: string;
  state: string;
  storage: { bytes: number | null; bytesCap: number | null; fileBytes: number; fileBytesCap: number | null };
};
type Ready = Account & { timeline: string };
type Inspection = { files: string[]; tables: string[]; head: { rev: number; bytes: number; timeline: string } | null; objects: number };
type Listing = {
  accounts: { accountId: string; state: string; bytes: number | null; disk: number | null; fileBytes: number }[];
  next: string | null;
};
type UsagePage = { accounts: number; totals: { bytes: number; disk: number; unread: number; readAt: number }; next: string | null };

const PORT = 4418;
const DATA = join(tmpdir(), 'hazelle-store-spec');
const PROOF = Buffer.alloc(32, 7).toString('base64');
const headers = (actor: Actor) => ({ cookie: actor.cookie, 'x-account': actor.accountId });
const hash = (body: string | Buffer) => createHash('sha256').update(body).digest('hex');
const write = (body: string, id: string = randomUUID()): Write => ({ id, kind: 'chat', parent: null, body, baseRev: null });
let operator: Actor;
let server: ChildProcess;

test.use({ baseURL: `http://localhost:${PORT}` });

async function start(fresh = false) {
  server = await startServer(PORT, DATA, fresh);
}

const stop = (signal: 'SIGTERM' | 'SIGKILL') => stopServer(server, signal);

async function restart(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
  await stop(signal);
  await start();
}

async function json<T>(response: APIResponse, status = 200): Promise<T> {
  expect(response.status(), `${response.url()}: ${(await response.text()).slice(0, 300)}`).toBe(status);
  return response.json() as Promise<T>;
}

// The account's database as the server keeps it: accounts/<incarnation>.sqlite with its -wal and -shm. Opened beside
// the server's own connection, read only by what is asked, and closed again.
function inspect(account: Account): Inspection {
  const files = readdirSync(join(DATA, 'accounts')).filter((name) => name.startsWith(`${account.incarnation}.`));
  const path = join(DATA, 'accounts', `${account.incarnation}.sqlite`);
  if (!existsSync(path)) return { files, tables: [], head: null, objects: 0 };
  const db = new DatabaseSync(path);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('head', 'objects') ORDER BY name").all().map((row) => row.name as string);
    const head = (db.prepare('SELECT rev, bytes, timeline FROM head').get() as Inspection['head'] | undefined) ?? null;
    const objects = Number(db.prepare('SELECT COUNT(*) AS n FROM objects').get()!.n);
    return { files, tables, head: head && { ...head }, objects };
  } finally {
    db.close();
  }
}

// The account's pictures on disk, as files/<incarnation>/<id>.
function prefix(account: Account): string[] {
  // Read once: the server removes a leaving account's directory while this polls, so a check before the read races it.
  try {
    return readdirSync(join(DATA, 'files', account.incarnation)).map((name) => `files/${account.incarnation}/${name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function signup(request: APIRequestContext, accountId: string = randomUUID()): Promise<Account> {
  const response = await request.post('/api/signup', {
    data: {
      accountId, username: `store-${randomUUID().slice(0, 18)}`,
      passwordProof: PROOF, recoveryProof: PROOF,
      passwordWrap: 'cGFzc3dvcmQgd3JhcA==', recoveryWrap: 'cmVjb3Zlcnkgd3JhcA==',
    },
  });
  const account = await json<Omit<Account, 'cookie'>>(response, 201);
  const cookie = response.headers()['set-cookie']?.split(';')[0];
  expect(cookie).toMatch(/^__Host-session=.+/);
  return { ...account, cookie: cookie! };
}

async function feed(request: APIRequestContext, account: Account, params: Record<string, string | number> = {}) {
  return request.get('/api/objects', { headers: headers(account), params: { since: 0, known: 0, bootstrap: 1, ...params } });
}

async function ready(request: APIRequestContext, accountId?: string): Promise<Ready> {
  const account = await signup(request, accountId);
  const page = await json<FeedPage>(await feed(request, account));
  expect(page.timeline).toMatch(/^[0-9a-f]{32}$/);
  return { ...account, timeline: page.timeline };
}

async function batch(request: APIRequestContext, account: Ready, writes: Write[]) {
  return request.post('/api/objects/batch', { headers: headers(account), data: { timeline: account.timeline, writes, files: [] } });
}

async function put(request: APIRequestContext, account: Account, body: Buffer) {
  const response = await request.put(`/api/files/${hash(body)}`, { headers: { ...headers(account), 'content-type': 'application/octet-stream' }, data: body });
  expect(response.status()).toBe(204);
}

async function leave(request: APIRequestContext, account: Account) {
  const response = await request.delete('/api/account', { headers: headers(account), data: { method: 'password', proof: PROOF } });
  expect(response.status(), (await response.text()).slice(0, 300)).toBe(204);
}

async function listing(request: APIRequestContext) {
  let next: string | null = null;
  const accounts: Listing['accounts'] = [];
  do {
    const page: Listing = await json<Listing>(await request.get(`/api/admin/accounts${next === null ? '' : `?after=${encodeURIComponent(next)}`}`, { headers: headers(operator) }));
    expect(page.accounts.length).toBeLessThanOrEqual(100);
    accounts.push(...page.accounts);
    next = page.next;
  } while (next !== null);
  return accounts;
}

test.beforeAll(async ({ request }) => {
  await start(true);
  // The first signup claims the installation.
  operator = await signup(request);
  expect(await json(await request.get('/api/session', { headers: headers(operator) }))).toMatchObject({ session: { admin: true } });
  expect((await request.put('/api/admin/service', {
    headers: headers(operator), data: { signupCap: 192, accountBytesCap: 300_000_000, accountFileBytesCap: null },
  })).status()).toBe(204);
});

test.afterAll(async () => {
  await stop('SIGTERM');
});

test('signup reads the first usage from a newly initialized store', async ({ request }) => {
  const account = await signup(request);
  expect(account.state).toBe('active');
  expect(account.incarnation).toMatch(/^[0-9a-f]{32}$/);
  expect(account.storage).toEqual({ bytes: 0, bytesCap: 300_000_000, fileBytes: 0, fileBytesCap: null });
  const first = inspect(account);
  expect(first.tables).toEqual(['head', 'objects']);
  expect(first.head).toEqual({ rev: 0, bytes: 0, timeline: expect.stringMatching(/^[0-9a-f]{32}$/) });
  const row = (await listing(request)).find((each) => each.accountId === account.accountId);
  expect(row?.bytes).toBe(0);
  expect(row?.disk).toBeGreaterThan(0);
  const page = await json<FeedPage>(await feed(request, account));
  expect(page).toMatchObject({ changes: [], cursor: 0, until: 0, more: false, timeline: first.head!.timeline });
});

test('a 1,500,000-byte body survives the HTTP round trip', async ({ request }) => {
  const account = await ready(request);
  const body = 'a'.repeat(1_500_000);
  const item = write(body);
  const response = await batch(request, account, [item]);
  expect(await json(response)).toEqual({ revs: [1], timeline: account.timeline });
  expect(response.headers()['x-account-bytes']).toBe(String(1_500_000 + ROW_BYTES.object));
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes).toHaveLength(1);
  expect(page.changes[0]).toMatchObject({ id: item.id, rev: 1 });
  expect(Buffer.byteLength(page.changes[0]!.body!)).toBe(1_500_000);
  expect(hash(page.changes[0]!.body!)).toBe(hash(body));
});

test('a Korean feed includes the row crossing four megabytes and continues on the next page', async ({ request }) => {
  const account = await ready(request);
  const body = '한'.repeat(500_000);
  const writes = [write(body), write(body), write(body), write('tail')];
  expect(Buffer.byteLength(body)).toBe(1_500_000);
  for (const item of writes) await json(await batch(request, account, [item]));
  const response = await feed(request, account, { timeline: account.timeline });
  expect(response.headers()['x-account-bytes']).toBe(String(4_500_004 + 4 * ROW_BYTES.object));
  expect(Buffer.byteLength(await response.body())).toBeGreaterThan(4_000_000);
  const page = await json<FeedPage>(response);
  expect(page).toMatchObject({ cursor: 3, until: 4, more: true, timeline: account.timeline });
  expect(page.changes.map((row) => row.id)).toEqual(writes.slice(0, 3).map((row) => row.id));
  expect(page.changes.map((row) => row.rev)).toEqual([1, 2, 3]);
  expect(page.changes.map((row) => Buffer.byteLength(row.body!))).toEqual([1_500_000, 1_500_000, 1_500_000]);
  expect(page.changes.map((row) => hash(row.body!))).toEqual(Array(3).fill(hash(body)));
  const next = await json<FeedPage>(await feed(request, account, { timeline: account.timeline, since: 3, known: 4, until: 4 }));
  expect(next).toMatchObject({ cursor: 4, until: 4, more: false, timeline: account.timeline });
  expect(next.changes).toEqual([{ id: writes[3]!.id, kind: 'chat', parent: null, rev: 4, body: 'tail' }]);
});

test('a conflict in the last batch item leaves every row and the head unchanged', async ({ request }) => {
  const account = await ready(request);
  const first = write('first');
  const last = write('last');
  await json(await batch(request, account, [first, last]));
  const before = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  const fresh = write('new');
  expect(await json(await batch(request, account, [fresh, { ...first, body: 'changed', baseRev: 1 }, { ...last, baseRev: 1 }]), 409)).toEqual({ error: 'conflict' });
  expect(await json(await feed(request, account, { timeline: account.timeline }))).toEqual(before);
  expect(inspect(account)).toMatchObject({ objects: 2, head: { rev: 2, bytes: 9 } });
  expect(await json(await batch(request, account, [fresh]))).toEqual({ revs: [3], timeline: account.timeline });
});

test('a stale timeline is refused by both the batch and the feed without writing', async ({ request }) => {
  const account = await ready(request);
  const stale = account.timeline === 'f'.repeat(32) ? '0'.repeat(32) : 'f'.repeat(32);
  const item = write('stale');
  expect(await json(await batch(request, { ...account, timeline: stale }, [item]), 409)).toEqual({ error: 'cache-reset' });
  expect(await json(await feed(request, account, { timeline: stale }), 409)).toEqual({ error: 'cache-reset' });
  expect(inspect(account)).toMatchObject({ objects: 0, head: { rev: 0, bytes: 0, timeline: account.timeline } });
  expect(await json(await batch(request, account, [item]))).toEqual({ revs: [1], timeline: account.timeline });
});

test('an account above its lowered cap can still delete an object', async ({ request }) => {
  const account = await ready(request);
  const item = write('a'.repeat(128));
  await json(await batch(request, account, [item]));
  expect((await request.put(`/api/admin/accounts/${account.accountId}/caps`, {
    headers: headers(operator), data: { bytesCap: 64, fileBytesCap: 'default' },
  })).status()).toBe(204);
  expect(await json(await batch(request, account, [write('new')]), 413)).toEqual({ error: 'storage-full' });
  const deleted = await batch(request, account, [{ ...item, body: null, baseRev: 1 }]);
  expect(await json(deleted)).toEqual({ revs: [2], timeline: account.timeline });
  expect(deleted.headers()['x-account-bytes']).toBe(String(ROW_BYTES.object));
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes).toEqual([{ id: item.id, kind: item.kind, parent: null, rev: 2, body: null }]);
  expect((await listing(request)).find((each) => each.accountId === account.accountId)).toMatchObject({ bytes: ROW_BYTES.object });
});

test('leaving invalidates the old cookie and a late batch stores nothing', async ({ request }) => {
  const account = await ready(request);
  await json(await batch(request, account, [write('before leaving')]));
  await leave(request, account);
  expect(await json(await feed(request, account, { timeline: account.timeline }), 401)).toEqual({ error: 'no-session' });
  expect(await json(await batch(request, account, [write('late')]), 401)).toEqual({ error: 'no-session' });
  expect(inspect(account)).toEqual({ files: [], tables: [], head: null, objects: 0 });
  expect(await json(await request.get('/api/session', { headers: headers(account) }))).toMatchObject({ session: null });
});

test('leaving removes its picture and preserves another account’s copy of the same content', async ({ request }) => {
  const owner = await ready(request);
  const other = await ready(request);
  const body = Buffer.from('sealed picture shared by two accounts');
  const id = hash(body);
  await put(request, owner, body);
  await put(request, other, body);
  expect(prefix(owner)).toEqual([`files/${owner.incarnation}/${id}`]);
  expect(prefix(other)).toEqual([`files/${other.incarnation}/${id}`]);
  await leave(request, owner);
  // The pictures go after the answer.
  await expect.poll(() => prefix(owner), { timeout: 5000, intervals: [25, 50, 100] }).toEqual([]);
  const kept = await request.get(`/api/files/${id}`, { headers: headers(other) });
  expect(kept.status()).toBe(200);
  expect(await kept.body()).toEqual(body);
  expect(prefix(other)).toEqual([`files/${other.incarnation}/${id}`]);
  expect(await json(await request.get('/api/session', { headers: headers(other) }))).toMatchObject({ session: { storage: { fileBytes: body.length } } });
});

// Simulate bytes from a PUT finishing after account deletion under its old incarnation.
// Real request timing cannot pause exactly there; the hourly job must remove these orphans.
test('the hourly job removes bytes an upload left under a deleted account and spares a live prefix', async ({ request }) => {
  test.setTimeout(180_000);
  const owner = await ready(request);
  const other = await ready(request);
  const body = Buffer.from('sealed picture whose put finishes late');
  const id = hash(body);
  await put(request, other, body);
  await leave(request, owner);
  await expect.poll(() => prefix(owner), { timeout: 5000, intervals: [25, 50, 100] }).toEqual([]);
  mkdirSync(join(DATA, 'files', owner.incarnation), { recursive: true });
  writeFileSync(join(DATA, 'files', owner.incarnation, id), body);
  await restart();
  await expect.poll(() => prefix(owner), { timeout: 90_000, intervals: [1000] }).toEqual([]);
  const kept = await request.get(`/api/files/${id}`, { headers: headers(other) });
  expect(kept.status()).toBe(200);
  expect(await kept.body()).toEqual(body);
});

test('reusing an account id gets a fresh incarnation with no old objects, usage, or pictures', async ({ request }) => {
  const old = await ready(request);
  const body = Buffer.from('old incarnation picture');
  await put(request, old, body);
  await json(await batch(request, old, [write('old object')]));
  await leave(request, old);
  const replacement = await ready(request, old.accountId);
  expect(replacement.incarnation).not.toBe(old.incarnation);
  expect(replacement.timeline).not.toBe(old.timeline);
  expect(replacement.storage).toMatchObject({ bytes: 0, fileBytes: 0 });
  expect(prefix(replacement)).toEqual([]);
  const page = await json<FeedPage>(await feed(request, replacement, { timeline: replacement.timeline }));
  expect(page).toMatchObject({ changes: [], cursor: 0, until: 0, more: false });
  expect(await json(await request.get('/api/session', { headers: headers(replacement) }))).toMatchObject({ session: { storage: { bytes: 0, fileBytes: 0 } } });
  expect(await json(await request.post('/api/files/missing', { headers: headers(replacement), data: { ids: [hash(body)] } }))).toEqual({ missing: [hash(body)], maxBytes: 25 * 1024 * 1024, room: null });
  expect((await request.get(`/api/files/${hash(body)}`, { headers: headers(replacement) })).status()).toBe(404);
  expect(await json(await batch(request, old, [write('late old cookie')]), 401)).toEqual({ error: 'no-session' });
  expect(await json(await batch(request, replacement, [write('new object')]))).toEqual({ revs: [1], timeline: replacement.timeline });
  await expect.poll(() => prefix(old), { timeout: 5000, intervals: [25, 50, 100] }).toEqual([]);
});

test('a deletion removes the account file with its WAL, and a restarted server neither brings it back nor admits the old session', async ({ request }) => {
  const account = await ready(request);
  await json(await batch(request, account, [write('must disappear')]));
  expect(inspect(account)).toMatchObject({ tables: ['head', 'objects'], objects: 1 });
  await leave(request, account);
  expect(inspect(account).files).toEqual([]);
  await restart();
  expect(await json(await feed(request, account, { timeline: account.timeline }), 401)).toEqual({ error: 'no-session' });
  expect(await json(await batch(request, account, [write('after restart')]), 401)).toEqual({ error: 'no-session' });
  expect(await json(await request.get('/api/session', { headers: headers(account) }))).toMatchObject({ session: null });
  expect(inspect(account).files).toEqual([]);
});

test('concurrent calls during a store wake commit distinct revisions', async ({ request }) => {
  const account = await ready(request);
  await restart();
  const writes = Array.from({ length: 8 }, (_, index) => write(`wake-${index}`));
  const answers = await Promise.all(writes.map(async (item) => json<{ revs: number[]; timeline: string }>(await batch(request, account, [item]))));
  expect(answers.map((answer) => answer.revs).flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(answers.map((answer) => answer.timeline)).toEqual(Array(8).fill(account.timeline));
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes.map((row) => row.id).sort()).toEqual(writes.map((item) => item.id).sort());
  expect(inspect(account)).toMatchObject({ objects: 8, head: { rev: 8, bytes: 48, timeline: account.timeline } });
});

test('an acknowledged batch is still readable after the process is killed and started again', async ({ request }) => {
  const account = await ready(request);
  const item = write('committed before the kill');
  await json(await batch(request, account, [item]));
  const before = inspect(account);
  await restart('SIGKILL');
  const page = await json<FeedPage>(await feed(request, account, { timeline: account.timeline }));
  expect(page.changes).toEqual([{ id: item.id, kind: item.kind, parent: null, rev: 1, body: item.body }]);
  expect(inspect(account).head).toEqual(before.head);
});

test('the operator reads bounded account pages and separately refreshes usage totals', async ({ request }) => {
  const usage = async () => {
    let next: string | null = null;
    const sum = { bytes: 0, disk: 0, unread: 0, readAt: 0 };
    do {
      const page: UsagePage = await json<UsagePage>(await request.get(`/api/admin/usage${next === null ? '' : `?after=${encodeURIComponent(next)}`}`, { headers: headers(operator) }));
      expect(page.accounts).toBeLessThanOrEqual(100);
      sum.bytes += page.totals.bytes;
      sum.disk += page.totals.disk;
      sum.unread += page.totals.unread;
      sum.readAt = page.totals.readAt;
      next = page.next;
    } while (next !== null);
    return sum;
  };
  const before = await listing(request);
  const beforeUsage = await usage();
  const added: { account: Ready; bytes: number }[] = [];
  for (let group = 0; group < 26; group++) {
    const accounts = await Promise.all(Array.from({ length: 4 }, () => ready(request)));
    for (const account of accounts) {
      const body = `fan-out-${added.length}-한`;
      await json(await batch(request, account, [write(body)]));
      added.push({ account, bytes: Buffer.byteLength(body) + ROW_BYTES.object });
    }
  }
  const started = Date.now();
  const after = await listing(request);
  const afterUsage = await usage();
  expect(after).toHaveLength(before.length + 104);
  expect(afterUsage.unread).toBe(0);
  expect(afterUsage.readAt).toBeGreaterThanOrEqual(started);
  expect(afterUsage.readAt).toBeLessThanOrEqual(Date.now());
  for (const { account, bytes } of added) {
    const row = after.find((each) => each.accountId === account.accountId);
    expect(row).toMatchObject({ state: 'active', bytes, fileBytes: 0 });
    expect(row!.disk).toBeGreaterThan(0);
  }
  expect(afterUsage.bytes).toBe(beforeUsage.bytes + added.reduce((sum, row) => sum + row.bytes, 0));
  expect(afterUsage.disk).toBe(after.reduce((sum, row) => sum + row.disk!, 0));
});
