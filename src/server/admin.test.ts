import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { forgetOldRecords, readAll } from './admin';
import { ROW_BYTES } from './caps';
import { sha256Hex, type Services } from './http';
import { signupBody, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 3').run();
});

// The first signup of an installation is its operator, so a test calls this before t.signUp().
const operator = () => t.signUp('operator');

const log = async (cookie: string) => ((await (await t.get('admin/log', cookie)).json()) as { log: { action: string; target: string; detail: unknown }[] }).log;

async function stored(bytes: Uint8Array<ArrayBuffer>, cookie: string) {
  const id = sha256Hex(bytes);
  await t.put(`files/${id}`, bytes, cookie);
  return id;
}

describe('the operator', () => {
  it('shows daily visit totals only to the operator, never a signed-out visitor or another account', async () => {
    const admin = await operator();
    const other = await t.signUp('other');
    expect((await t.get('admin/visits')).status).toBe(401);
    expect((await t.get('admin/visits', other.cookie)).status).toBe(403);
    const answer = await t.get('admin/visits', admin.cookie);
    expect(answer.status).toBe(200);
    const { days } = await answer.json() as { days: unknown[] };
    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({ day: expect.any(Number), visitors: 0, opened: 0, connected: 0, guests: 0, accounts: 2, converted: 0 });
  });

  it('is the first account signed up: the session says so, nobody else passes, and the installation keeps naming it', async () => {
    const admin = await operator();
    const other = await t.signUp('other');
    expect(await (await t.get('session', admin.cookie)).json()).toMatchObject({ session: { admin: true } });
    expect(await (await t.get('session', other.cookie)).json()).toMatchObject({ session: { admin: false } });

    const refused = await t.get('admin/accounts', other.cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'not-admin' });

    expect(await t.env.db.prepare('SELECT operator_account FROM installation').first('operator_account')).toBe(admin.id);
  });

  it("lists each account with its store's bytes, its pictures and its own caps, and separately totals what the stores answered", async () => {
    const admin = await operator();
    const other = await t.signUp('other');
    const leaving = await t.signUp('leaving');
    await stored(new Uint8Array([1, 2, 3]), other.cookie);
    const writes = ['a', 'b'].map((body) => ({ id: crypto.randomUUID(), kind: 'asset', parent: null, body: body.repeat(10), baseRev: null }));
    await t.batch(writes, other.cookie);
    await t.batch(writes.map((write) => ({ ...write, id: crypto.randomUUID() })), admin.cookie);
    await t.lifecycle(leaving.id, "state = 'leaving'");

    const answer = (await (await t.get('admin/accounts', admin.cookie)).json()) as { accounts: Record<string, unknown>[]; next: string | null };
    const row = { createdAt: expect.any(Number), suspended: false, state: 'active', disk: expect.any(Number), bytesCap: 'default', fileBytesCap: 'default' };
    expect(answer.accounts).toEqual([
      { ...row, accountId: admin.id, username: 'operator', bytes: 20 + 2 * ROW_BYTES.object, fileBytes: 0 },
      { ...row, accountId: other.id, username: 'other', bytes: 20 + 2 * ROW_BYTES.object, fileBytes: 3 },
      { ...row, accountId: leaving.id, username: 'leaving', state: 'leaving', bytes: null, disk: null, fileBytes: 0 },
    ]);
    expect(answer.next).toBeNull();
    const flagged = (await (await t.get('admin/accounts?flagged=1', admin.cookie)).json()) as { accounts: { accountId: string }[] };
    expect(flagged.accounts.map(({ accountId }) => accountId)).toEqual([leaving.id]);
    expect(await (await t.get('admin/usage', admin.cookie)).json()).toEqual({ accounts: 3, totals: { bytes: 40 + 4 * ROW_BYTES.object, disk: expect.any(Number), unread: 1, readAt: expect.any(Number) }, next: null });
    expect(await (await t.get('admin/service', admin.cookie)).json()).toMatchObject({ accounts: 3, people: 2 });
  });

  it('bounds account and usage pages, continues tied timestamps, and refreshes one row without a service fan-out', async () => {
    const admin = await operator();
    const ids = Array.from({ length: 101 }, () => crypto.randomUUID());
    await t.env.db.prepare(`INSERT INTO accounts (id, username, login_hash, created_at, incarnation, timeline)
      SELECT value, 'member-' || value, login_hash, created_at + 1, lower(hex(randomblob(16))), lower(hex(randomblob(16)))
      FROM accounts, json_each(?1) WHERE accounts.id = ?2`).bind(JSON.stringify(ids), admin.id).run();
    const stores = t.env.stores;
    let calls = 0;
    t.env.stores = { getByName: () => ({ usage: async () => { calls++; return { bytes: 2, disk: 4 }; } }) } as unknown as Services['stores'];
    try {
      type Page = { accounts: { accountId: string }[]; next: string | null };
      const first = await (await t.get('admin/accounts', admin.cookie)).json() as Page;
      expect(first.accounts).toHaveLength(100);
      expect(calls).toBe(100);
      const second = await (await t.get(`admin/accounts?after=${encodeURIComponent(first.next!)}`, admin.cookie)).json() as Page;
      expect(second.accounts).toHaveLength(2);
      expect(second.next).toBeNull();
      expect(new Set([...first.accounts, ...second.accounts].map(({ accountId }) => accountId)).size).toBe(102);
      expect(calls).toBe(102);

      const row = await (await t.get(`admin/accounts/${ids[0]!}`, admin.cookie)).json();
      expect(row).toMatchObject({ account: { accountId: ids[0], bytes: 2 } });
      expect(calls).toBe(103);
      expect(await (await t.get('admin/usage', admin.cookie)).json()).toMatchObject({ accounts: 100, totals: { bytes: 200, disk: 400, unread: 0 }, next: first.next });
      expect(calls).toBe(203);
      expect((await t.get('admin/accounts?after=invalid', admin.cookie)).status).toBe(400);
    } finally {
      t.env.stores = stores;
    }
  });

  it('pages a newest-first list by limit and next, and narrows reports to the open ones', async () => {
    const admin = await operator();
    const other = await t.signUp('other');
    const post = await t.askOperator(other.id);
    for (const text of ['one', 'two', 'three']) {
      await t.env.db.prepare(`INSERT INTO reports (account_id, username, text, created_at, post_id) VALUES (?, 'other', ?, ?, ?)`).bind(other.id, text, Date.now(), post).run();
    }
    type Page = { reports: { id: number; text: string }[]; next: string | null };
    const listed = async (query: string) => {
      const page = (await (await t.get(`admin/reports?${query}`, admin.cookie)).json()) as Page;
      return [page.reports.map(({ text }) => text), page.next];
    };
    const first = (await (await t.get('admin/reports?limit=2', admin.cookie)).json()) as Page;
    expect([first.reports.map(({ text }) => text), first.next]).toEqual([['three', 'two'], String(first.reports[1]!.id)]);
    expect(await listed(`limit=2&after=${first.next}`)).toEqual([['one'], null]);
    await t.post(`admin/reports/${first.reports[0]!.id}/resolve`, undefined, admin.cookie);
    expect(await listed('open=1')).toEqual([['two', 'one'], null]);
    expect((await t.get('admin/reports?limit=101', admin.cookie)).status).toBe(400);
  });

  it('keeps at most fifty store reads in flight and answers the ones unsettled at the deadline as unread', async () => {
    let flying = 0;
    let most = 0;
    let started = 0;
    const releases: (() => void)[] = [];
    const calls = Array.from({ length: 120 }, (_, index) => async () => {
      started++;
      flying++;
      most = Math.max(most, flying);
      // Every other store is slow: it answers only after the deadline.
      if (index % 2 === 0) await new Promise<void>((resolve) => releases.push(resolve));
      flying--;
      return index;
    });
    const read = await readAll(calls, 50, 100);
    const answered = read.filter((answer) => answer !== undefined);
    expect(most).toBe(50);
    expect(answered.length).toBe(started - 50);
    expect(read.every((answer, index) => answer === undefined || answer === index)).toBe(true);
    const startedByDeadline = started;
    for (const release of releases) release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect([started, read.filter((answer) => answer !== undefined).length]).toEqual([startedByDeadline, answered.length]);
  });

  it('suspends an account, lifts it and deletes the account, logging each with the username', async () => {
    const admin = await operator();
    const other = await t.signUp('other');
    const timeline = await t.timeline(other.cookie);
    const write = () => t.post('objects/batch', { timeline, files: [], writes: [{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }] }, other.cookie);

    expect((await t.put(`admin/accounts/${other.id}/suspended`, { suspended: true, reason: '도배' }, admin.cookie)).status).toBe(204);
    expect((await write()).status).toBe(403);
    expect((await t.put(`admin/accounts/${other.id}/suspended`, { suspended: false }, admin.cookie)).status).toBe(204);
    expect((await write()).status).toBe(200);
    expect((await t.delete(`admin/accounts/${other.id}`, undefined, admin.cookie)).status).toBe(204);
    expect((await write()).status).toBe(401);
    expect((await t.delete(`admin/accounts/${other.id}`, undefined, admin.cookie)).status).toBe(404);

    expect(await log(admin.cookie)).toMatchObject(
      ['delete-account', 'lift', 'send-notice', 'suspend'].map((action) => ({ action, target: other.id, detail: { username: 'other' } })),
    );
  });

  it('reads the service values with their totals and sets them, which opens signup again', async () => {
    const admin = await operator();
    await stored(new Uint8Array([1, 2, 3]), admin.cookie);
    const service = (await (await t.get('admin/service', admin.cookie)).json()) as { databaseBytes: number };
    expect(service).toEqual({
      signupCap: 3, accountBytesCap: null, accountFileBytesCap: null, accounts: 1, people: 1, pending: 0, fileBytes: 3, links: 0,
      databaseBytes: expect.any(Number), backupAgeHours: null, diskFreePercent: 50, warnings: [],
    });
    expect(service.databaseBytes).toBeGreaterThan(0);

    expect((await t.put('admin/service', { signupCap: 1, accountBytesCap: 1000, accountFileBytesCap: 2000 }, admin.cookie)).status).toBe(204);
    expect((await t.post('signup', signupBody('late'))).status).toBe(403);
    expect((await t.put('admin/service', { signupCap: 2, accountBytesCap: null, accountFileBytesCap: null }, admin.cookie)).status).toBe(204);
    expect((await t.post('signup', signupBody('late'))).status).toBe(201);
    expect((await log(admin.cookie))[0]).toMatchObject({ action: 'set-service', target: 'service', detail: { signupCap: 2, accountBytesCap: null, accountFileBytesCap: null } });
  });

  it("gives an account its own caps in place of the service's, none among them, and logs each", async () => {
    const admin = await operator();
    const other = await t.signUp('other');
    await t.env.db.prepare('UPDATE service SET account_bytes_cap = 0, account_file_bytes_cap = 0').run();
    const write = async () => (await t.batch([{ id: crypto.randomUUID(), kind: 'chat', parent: null, body: 'sealed', baseRev: null }], other.cookie)).status;
    const session = async () => ((await (await t.get('session', other.cookie)).json()) as { session: { storage: unknown } }).session.storage;
    expect(await write()).toBe(413);

    expect((await t.put(`admin/accounts/${other.id}/caps`, { bytesCap: null, fileBytesCap: 5 }, admin.cookie)).status).toBe(204);
    expect(await write()).toBe(200);
    expect(await session()).toEqual({ bytes: 6 + ROW_BYTES.object, bytesCap: null, fileBytes: 0, fileBytesCap: 5 });

    expect((await t.put(`admin/accounts/${other.id}/caps`, { bytesCap: 'default', fileBytesCap: 'default' }, admin.cookie)).status).toBe(204);
    expect(await write()).toBe(413);
    expect(await session()).toEqual({ bytes: 6 + ROW_BYTES.object, bytesCap: 0, fileBytes: 0, fileBytesCap: 0 });
    expect((await t.put(`admin/accounts/${other.id}/caps`, { bytesCap: -1, fileBytesCap: 'default' }, admin.cookie)).status).toBe(400);
    expect(await log(admin.cookie)).toMatchObject([
      { action: 'set-caps', target: other.id, detail: { username: 'other', bytesCap: 'default', fileBytesCap: 'default' } },
      { action: 'set-caps', target: other.id, detail: { username: 'other', bytesCap: null, fileBytesCap: 5 } },
    ]);
  });

  it('blocks a stored file for every account: no read, no upload, and an import is told the server does not hold it', async () => {
    const admin = await operator();
    const other = await t.signUp('other');
    const bytes = new Uint8Array([4, 5, 6]);
    const id = await stored(bytes, other.cookie);
    const put = () => t.put(`files/${id}`, bytes, other.cookie);
    const missing = async () => ((await (await t.post('files/missing', { ids: [id] }, other.cookie)).json()) as { missing: string[] }).missing;

    expect((await t.put(`admin/files/${id}/blocked`, { blocked: true }, admin.cookie)).status).toBe(204);
    for (const response of [await t.get(`files/${id}`, other.cookie), await put()]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'file-blocked' });
    }
    expect(await missing()).toEqual([id]);

    expect((await t.put(`admin/files/${id}/blocked`, { blocked: false }, admin.cookie)).status).toBe(204);
    expect(new Uint8Array(await (await t.get(`files/${id}`, other.cookie)).arrayBuffer())).toEqual(bytes);
    expect(await missing()).toEqual([]);
    // A block needs no holder.
    const nobody = '0'.repeat(64);
    expect((await t.put(`admin/files/${nobody}/blocked`, { blocked: true }, admin.cookie)).status).toBe(204);
    expect(await log(admin.cookie)).toMatchObject([{ action: 'block-file', target: nobody }, { action: 'unblock-file', target: id }, { action: 'block-file', target: id }]);
  });
});

it('forgets resolved reports, settled operator-only posts and log rows a year old, and keeps an open report and a public post of any age', async () => {
  const year = 365 * 24 * 60 * 60 * 1000;
  const old = Date.now() - year - 60_000;
  const recent = Date.now() - year + 60_000;
  await t.env.db.batch([
    ...([
      [1, old, null],
      [2, old, old],
      [3, old, recent],
    ] as const).map(([id, created, resolved]) => t.env.db.prepare(`INSERT INTO reports (id, account_id, username, text, created_at, resolved_at) VALUES (?, 'a', 'a', 'text', ?, ?)`).bind(id, created, resolved)),
    ...[old, recent].map((at) => t.env.db.prepare(`INSERT INTO admin_log (at, action, target) VALUES (?, 'lift', 'a')`).bind(at)),
    ...([
      [1, 'operator', 'done', old],
      [2, 'operator', 'open', old],
      [3, 'operator', 'seen', recent],
      [4, 'public', 'done', old],
    ] as const).map(([id, visibility, status, at]) =>
      t.env.db.prepare(`INSERT INTO posts (id, title, text, category, visibility, status, status_at, created_at) VALUES (?, 't', 't', 'bug', ?, ?, ?, ?)`).bind(id, visibility, status, at, old),
    ),
  ]);
  await forgetOldRecords(t.env.db);
  expect((await t.env.db.prepare('SELECT id FROM reports ORDER BY id').all()).results).toEqual([{ id: 1 }, { id: 3 }]);
  expect((await t.env.db.prepare('SELECT at FROM admin_log').all()).results).toEqual([{ at: recent }]);
  expect((await t.env.db.prepare('SELECT id FROM posts ORDER BY id').all()).results).toEqual([{ id: 2 }, { id: 3 }, { id: 4 }]);
});
