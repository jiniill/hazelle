import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROW_BYTES } from './caps';
import { BATCH_LIMITS } from '../contracts/objects';
import { sha256Hex } from './http';
import { testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

async function write(cookie: string, id: string, input: Record<string, unknown>) {
  const response = await t.batch([{ id, parent: null, baseRev: null, ...input }], cookie);
  return { status: response.status, json: (await response.json()) as { revs?: number[]; error?: string } };
}

describe('objects', () => {
  it('reclaims files before publishing references, even over the cap, and publishes nothing for a deleting file', async () => {
    const { cookie } = await t.signUp();
    const bytes = new Uint8Array([1, 2, 3]);
    const id = sha256Hex(bytes);
    await t.put(`files/${id}`, bytes, cookie);
    await t.env.db.prepare('UPDATE account_files SET claimed_at = 0').run();
    const inventory = await (await t.get('files', cookie)).json() as { timeline: string; rev: number };
    expect(await (await t.post('files/sweep', { ...inventory, unused: [id], named: [] }, cookie)).json()).toEqual({ released: 1, taken: 0 });
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 0').run();
    const object = { id: A, kind: 'asset', parent: null, body: 'sealed-reference', baseRev: null };
    const claimed = await t.batch([object], cookie, [id]);
    expect(claimed.status).toBe(200);
    expect(claimed.headers.get('x-account-file-bytes')).toBe('3');
    expect((await t.get(`files/${id}`, cookie)).status).toBe(200);
    // The same walk cannot release a file after that object write, even once the claim has settled.
    await t.env.db.prepare('UPDATE account_files SET claimed_at = 0').run();
    expect((await t.post('files/sweep', { ...inventory, unused: [id], named: [] }, cookie)).status).toBe(409);
    expect(await t.env.db.prepare('SELECT file_bytes FROM accounts').first('file_bytes')).toBe(3);

    await t.batch([{ ...object, body: null, baseRev: 1 }], cookie);
    const next = await (await t.get('files', cookie)).json() as { timeline: string; rev: number };
    await t.post('files/sweep', { ...next, unused: [id], named: [] }, cookie);
    await t.env.db.prepare('UPDATE file_removals SET removing = 1').run();
    expect((await t.batch([{ ...object, id: B }], cookie, [id])).status).toBe(503);
    expect(await t.env.db.prepare('SELECT file_bytes FROM accounts').first('file_bytes')).toBe(0);
    expect(t.stores.inspect((await t.env.db.prepare('SELECT incarnation FROM accounts').first<string>('incarnation'))!).exec('SELECT id FROM objects WHERE body IS NOT NULL')).toEqual([]);
    // A file the account lacks still lands; a batch without its file list does not.
    expect((await t.batch([{ ...object, id: B }], cookie, ['f'.repeat(64)])).status).toBe(200);
    expect((await t.post('objects/batch', { timeline: inventory.timeline, writes: [{ ...object, id: C }] }, cookie)).status).toBe(400);
  });

  it('creates, updates with a version check and syncs from a cursor, stating the timeline and the bytes held', async () => {
    const { cookie } = await t.signUp();
    const timeline = await t.timeline(cookie);
    expect(timeline).toMatch(/^[0-9a-f]{32}$/);
    expect(await write(cookie, A, { kind: 'settings', body: 'b25l' })).toEqual({ status: 200, json: { revs: [1], timeline } });
    expect(await write(cookie, A, { kind: 'settings', body: 'bmV3', baseRev: 1 })).toEqual({ status: 200, json: { revs: [2], timeline } });
    expect(await write(cookie, A, { kind: 'settings', body: 'c3RhbGU=', baseRev: 1 })).toEqual({ status: 409, json: { error: 'conflict' } });
    expect(await write(cookie, B, { kind: 'entry', parent: A, body: 'Yg==' })).toMatchObject({ status: 200 });
    expect(await write(cookie, B, { kind: 'entry', body: 'Yw==', baseRev: 3 })).toEqual({ status: 400, json: { error: 'bad-input' } });

    const feed = await t.get(`objects?since=1&timeline=${timeline}`, cookie);
    expect(feed.headers.get('x-account-bytes')).toBe(String(8 + 2 * ROW_BYTES.object));
    expect(await feed.json()).toEqual({
      limits: BATCH_LIMITS,
      timeline,
      changes: [
        { id: A, kind: 'settings', parent: null, rev: 2, body: 'bmV3' },
        { id: B, kind: 'entry', parent: A, rev: 3, body: 'Yg==' },
      ],
      cursor: 3,
      more: false,
    });
  });

  it('answers 409 cache-reset to another timeline, a cursor past the account, or a later page without a timeline, and writes nothing', async () => {
    const { cookie } = await t.signUp();
    const timeline = await t.timeline(cookie);
    const other = '0'.repeat(32);
    const sent = [
      await t.get(`objects?since=0&timeline=${other}`, cookie),
      await t.get(`objects?since=2&timeline=${timeline}`, cookie),
      await t.get('objects?since=1', cookie),
      await t.post('objects/batch', { timeline: other, files: [], writes: [{ id: A, kind: 'chat', parent: null, body: 'eA==', baseRev: null }] }, cookie),
    ];
    for (const response of sent) {
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: 'cache-reset', by: 'server' });
    }
    await t.env.db.prepare("INSERT INTO restores (incarnation, report_id, timeline, phase, created_at, updated_at) SELECT incarnation, 0, timeline, 'done', 0, 0 FROM accounts").run();
    expect(await (await t.get(`objects?since=0&timeline=${other}`, cookie)).json()).toEqual({ error: 'cache-reset', by: 'account' });
    expect((await (await t.get('objects?since=0', cookie)).json()) as object).toMatchObject({ changes: [] });
    expect((await t.post('objects/batch', { writes: [{ id: A, kind: 'chat', parent: null, body: 'eA==', baseRev: null }] }, cookie)).status).toBe(400);
  });

  it("holds an account to the cap its session read, creating nothing at it while changes may grow it a little", async () => {
    const { cookie } = await t.signUp();
    await write(cookie, A, { kind: 'settings', body: '가'.repeat(10) });
    await t.env.db.prepare('UPDATE service SET account_bytes_cap = ?').bind(30 + ROW_BYTES.object).run();
    expect(await write(cookie, B, { kind: 'chat', body: 'x' })).toEqual({ status: 413, json: { error: 'storage-full' } });
    const changed = await write(cookie, A, { kind: 'settings', body: '가'.repeat(11), baseRev: 1 });
    expect(changed.status).toBe(200);
    expect((await t.batch([{ id: A, kind: 'settings', parent: null, body: null, baseRev: 2 }], cookie)).headers.get('x-account-bytes')).toBe(String(ROW_BYTES.object));
  });

  it("throttles an account's batches before reading their bodies", async () => {
    const { cookie } = await t.signUp();
    const sent = await Promise.all(Array.from({ length: 2000 }, () => t.post('objects/batch', 'not a batch', cookie)));
    const throttled = sent.filter(({ status }) => status === 429);
    expect(throttled.length).toBeGreaterThan(0);
    expect(sent.length - throttled.length).toBeGreaterThanOrEqual(1200);
    expect(await throttled[0]!.json()).toEqual({ error: 'too-many-writes', retryAfter: 1 });
  });

  it('answers 503 with a wait while the account restores or its store cannot load, and 401 once it is leaving', async () => {
    const { id, cookie } = await t.signUp();
    const timeline = await t.timeline(cookie);
    const both = () => Promise.all([t.get(`objects?since=0&timeline=${timeline}`, cookie), t.post('objects/batch', { timeline, files: [], writes: [{ id: A, kind: 'chat', parent: null, body: 'eA==', baseRev: null }] }, cookie)]);

    await t.lifecycle(id, "state = 'restoring'");
    for (const response of await both()) expect(await response.json()).toEqual({ error: 'account-restoring', retryAfter: 5 });
    // A row the store cannot read as a lifecycle is not an answer that the account is gone.
    await t.lifecycle(id, "state = 'unknown'");
    for (const response of await both()) {
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'store-unavailable', retryAfter: 5 });
    }
    await t.lifecycle(id, "state = 'leaving'");
    for (const response of await both()) expect(response.status).toBe(401);
  });

  it('refuses malformed writes, an oversized body and a missing session', async () => {
    const { cookie } = await t.signUp();
    expect((await write(cookie, 'not-a-uuid', { kind: 'settings', body: 'eA==' })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'Settings', body: 'eA==' })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'lore', parent: 'x', body: 'eA==' })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'settings', body: 'eA==', baseRev: 0 })).status).toBe(400);
    expect((await write(cookie, A, { kind: 'settings', body: 'x'.repeat(1_500_001) })).status).toBe(413);
    expect((await t.get('objects?since=-1', cookie)).status).toBe(400);
    expect((await t.get('objects?since=0&timeline=short', cookie)).status).toBe(400);
    expect((await t.get('objects?since=3&until=2&bootstrap=1', cookie)).status).toBe(400);
    expect((await t.get('objects?since=0')).status).toBe(401);
  });

  it('enforces item and UTF-8 body budgets, including a streamed request without content-length', async () => {
    const { cookie } = await t.signUp();
    const timeline = await t.timeline(cookie);
    const item = () => ({ id: crypto.randomUUID(), kind: 'entry', parent: null, body: 'x', baseRev: null });
    expect((await t.batch([], cookie)).status).toBe(400);
    expect((await t.batch(Array.from({ length: BATCH_LIMITS.items + 1 }, item), cookie)).status).toBe(413);
    expect((await t.batch([{ ...item(), body: '한'.repeat(500_001) }], cookie)).status).toBe(413);
    const body = JSON.stringify({ timeline, writes: Array.from({ length: 3 }, () => ({ ...item(), body: 'x'.repeat(1_400_000) })) });
    expect((await t.raw('objects/batch', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body })).status).toBe(413);
    const accepted = await t.batch(Array.from({ length: BATCH_LIMITS.items }, item), cookie);
    expect(await accepted.json()).toEqual({ revs: Array.from({ length: BATCH_LIMITS.items }, (_, index) => index + 1), timeline });
    expect((await t.post('objects/batch', { timeline, writes: [item()] })).status).toBe(401);
  });
});
