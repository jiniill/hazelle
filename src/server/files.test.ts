import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETENTION_MS } from './db/account-db';
import type { SqlValue, Statement } from './db/service-db';
import { fileBlocks } from './files';
import { uploadBudget } from './limits';
import type { Bucket } from './files/bucket';
import { fakeS3 } from './files/fake-s3';
import { r2Bucket } from './files/r2-bucket';
import { sha256Hex, type AppEnv } from './http';
import { proof, testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(() => t.reset());

const signup = async (username?: string, accountId?: string) => {
  await t.env.db.prepare('UPDATE service SET signup_cap = signup_cap + 1').run();
  return t.signUp(username, accountId);
};
const put = (id: string, bytes: Uint8Array<ArrayBuffer>, cookie?: string) => t.put(`files/${id}`, bytes, cookie);
const missing = async (ids: string[], cookie: string) => ((await (await t.post('files/missing', { ids }, cookie)).json()) as { missing: string[] }).missing;
const rows = (incarnation: string) => t.env.db.prepare('SELECT size, stored FROM account_files WHERE incarnation = ?').bind(incarnation).all().then(({ results }) => results);
const sum = (incarnation: string) => t.env.db.prepare('SELECT file_bytes AS sum FROM accounts WHERE incarnation = ?').bind(incarnation).first<number>('sum');
const stored = async (incarnation: string, id: string) => {
  const body = await t.env.files.get(`files/${incarnation}/${id}`);
  return body ? new Response(body).arrayBuffer() : undefined;
};
const operator = new Hono<AppEnv>().route('/', fileBlocks);
const block = (id: string, blocked: boolean) =>
  operator.request(`/files/${id}/blocked`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blocked }) }, t.env);

async function withFilesPut(put: Bucket['put'], step: () => Promise<void>) {
  const files = t.env.files;
  t.env.files = { ...files, put };
  try {
    await step();
  } finally {
    t.env.files = files;
  }
}

describe('files', () => {
  it('keeps a separate copy and sum per account for the same content, and says which ids the asker lacks', async () => {
    const [jin, other] = [await signup(), await signup('other')];
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const id = sha256Hex(bytes);
    const absent = sha256Hex(new Uint8Array([9]));

    const first = await put(id, bytes, jin.cookie);
    expect(first.headers.get('x-account-file-bytes')).toBe('4');
    expect((await put(id, bytes, jin.cookie)).status).toBe(204);
    expect(await missing([id, absent], jin.cookie)).toEqual([absent]);
    expect(await missing([id, absent], other.cookie)).toEqual([id, absent]);
    expect((await t.get(`files/${id}`, other.cookie)).status).toBe(404);

    expect((await put(id, bytes, other.cookie)).headers.get('x-account-file-bytes')).toBe('4');
    expect([await sum(jin.incarnation), await sum(other.incarnation)]).toEqual([4, 4]);
    expect(new Uint8Array((await stored(other.incarnation, id))!)).toEqual(bytes);
    const read = await t.get(`files/${id}`, jin.cookie);
    expect(read.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(bytes);
    expect((await t.get(`files/${absent}`, jin.cookie)).status).toBe(404);

    expect((await t.delete('account', { method: 'password', proof: proof('password') }, other.cookie)).status).toBe(204);
    await t.settle();
    expect(await stored(other.incarnation, id)).toBeUndefined();
    expect(new Uint8Array(await (await t.get(`files/${id}`, jin.cookie)).arrayBuffer())).toEqual(bytes);
  });

  it('looks up requested file IDs by the account composite key rather than materializing its inventory', async () => {
    const { cookie } = await signup();
    const db = t.env.db;
    const plans: { detail: string }[] = [];
    t.env.db = new Proxy(db, {
      get: (target, key) => key === 'prepare' ? (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes('json_each(?2)')) return statement;
        return Object.assign(Object.create(statement) as Statement, {
          bind: (...values: SqlValue[]) => {
            const bound = statement.bind(...values);
            return Object.assign(Object.create(bound) as Statement, {
              all: async () => {
                plans.push(...(await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...values).all<{ detail: string }>()).results);
                return bound.all();
              },
            });
          },
        });
      } : (Reflect.get(target, key) as (...args: unknown[]) => unknown).bind(target),
    });
    try {
      const id = '0'.repeat(64);
      expect(await missing([id], cookie)).toEqual([id]);
      expect(plans.some(({ detail }) => detail.includes('incarnation=? AND id=?'))).toBe(true);
      expect(plans.some(({ detail }) => detail.includes('LIST SUBQUERY'))).toBe(false);
    } finally {
      t.env.db = db;
    }
  });

  it('refuses a body that is not its id, a bad id, an oversized body and a missing session', async () => {
    const { cookie } = await signup();
    const id = sha256Hex(new Uint8Array([1]));
    expect((await put(id, new Uint8Array([2]), cookie)).status).toBe(400);
    expect((await put('not-a-hash', new Uint8Array([1]), cookie)).status).toBe(400);
    expect((await put(id, new Uint8Array(25 * 1024 * 1024 + 1), cookie)).status).toBe(413);
    expect((await t.post('files/missing', { ids: ['x'] }, cookie)).status).toBe(400);
    expect((await put(id, new Uint8Array([1]))).status).toBe(401);
    expect((await t.get(`files/${id}`)).status).toBe(401);
  });

  it('finishes an upload cut after its reservation or after its bytes with one row and one charge', async () => {
    const jin = await signup();
    const [early, late] = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7])];
    const [earlyId, lateId] = [sha256Hex(early), sha256Hex(late)];
    const files = t.env.files;
    await withFilesPut(
      () => Promise.reject(new Error('cut before the bytes')),
      async () => expect((await put(earlyId, early, jin.cookie)).status).toBe(500),
    );
    await withFilesPut(
      async (key, value) => {
        await files.put(key, value);
        throw new Error('cut before the finalize');
      },
      async () => expect((await put(lateId, late, jin.cookie)).status).toBe(500),
    );
    expect(await rows(jin.incarnation)).toEqual([
      { size: 3, stored: 0 },
      { size: 4, stored: 0 },
    ]);
    expect(await missing([earlyId, lateId], jin.cookie)).toEqual([earlyId, lateId]);
    expect((await t.get(`files/${lateId}`, jin.cookie)).status).toBe(404);

    expect((await put(earlyId, early, jin.cookie)).headers.get('x-account-file-bytes')).toBe('7');
    expect((await put(lateId, late, jin.cookie)).headers.get('x-account-file-bytes')).toBe('7');
    expect(await rows(jin.incarnation)).toEqual([
      { size: 3, stored: 1 },
      { size: 4, stored: 1 },
    ]);
    expect(await missing([earlyId, lateId], jin.cookie)).toEqual([]);
  });

  it('holds what an account has released and not yet lost, with what it keeps, to twice the cap', async () => {
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 5').run();
    const jin = await signup();
    const [kept, small] = [new Uint8Array([1, 2, 3]), new Uint8Array([7])];
    expect((await put(sha256Hex(kept), kept, jin.cookie)).status).toBe(204);
    const release = (size: number) => t.env.db.prepare('INSERT OR REPLACE INTO file_removals (incarnation, id, size, created_at, released_at, due_at) VALUES (?, ?, ?, 0, 0, 0)').bind(jin.incarnation, '0'.repeat(64), size).run();
    await release(7);
    expect(await (await put(sha256Hex(small), small, jin.cookie)).json()).toEqual({ error: 'files-full' });
    await release(6);
    expect((await put(sha256Hex(small), small, jin.cookie)).status).toBe(204);
  });

  it('refuses a file past the cap at its reservation, storing nothing, under the account’s own cap when it has one', async () => {
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 5').run();
    const jin = await signup();
    const [kept, large] = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    expect((await put(sha256Hex(kept), kept, jin.cookie)).status).toBe(204);
    expect(await (await t.post('files/missing', { ids: [sha256Hex(large)] }, jin.cookie)).json()).toMatchObject({ room: 2 });

    const refused = await put(sha256Hex(large), large, jin.cookie);
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual({ error: 'files-full' });
    expect(await stored(jin.incarnation, sha256Hex(large))).toBeUndefined();
    expect(await sum(jin.incarnation)).toBe(3);

    await t.env.db.prepare('UPDATE accounts SET own_file_bytes_cap = 1, file_bytes_cap = 6 WHERE id = ?').bind(jin.id).run();
    expect((await put(sha256Hex(large), large, jin.cookie)).headers.get('x-account-file-bytes')).toBe('6');
  });

  it('charges only one concurrent reservation near the cap and retries it after a cap reduction', async () => {
    const { cookie, incarnation } = await signup();
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 3').run();
    const bodies = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
    const ids = bodies.map(sha256Hex);
    const replies = await Promise.all(bodies.map((body, index) => put(ids[index]!, body, cookie)));
    expect(replies.map(({ status }) => status).sort()).toEqual([204, 413]);
    expect(await sum(incarnation)).toBe(3);
    expect(await rows(incarnation)).toEqual([{ size: 3, stored: 1 }]);

    const kept = replies.findIndex(({ status }) => status === 204);
    await t.env.db.prepare('UPDATE account_files SET stored = 0 WHERE incarnation = ?').bind(incarnation).run();
    await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 0').run();
    const retried = await Promise.all([put(ids[kept]!, bodies[kept]!, cookie), put(ids[kept]!, bodies[kept]!, cookie)]);
    expect(retried.map(({ status }) => status)).toEqual([204, 204]);
    expect(await sum(incarnation)).toBe(3);
    await t.env.db.prepare('DELETE FROM accounts WHERE incarnation = ?').bind(incarnation).run();
    expect(await rows(incarnation)).toEqual([]);
    expect(await sum(incarnation)).toBeNull();
  });

  it('refuses blocked content to every account that holds it, and brings every copy back when lifted', async () => {
    const [jin, other] = [await signup(), await signup('other')];
    const bytes = new Uint8Array([7, 7]);
    const id = sha256Hex(bytes);
    for (const { cookie } of [jin, other]) await put(id, bytes, cookie);

    expect((await block(id, true)).status).toBe(204);
    expect((await block(id, true)).status).toBe(204);
    for (const { cookie } of [jin, other]) {
      for (const response of [await t.get(`files/${id}`, cookie), await put(id, bytes, cookie)]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'file-blocked' });
      }
      expect(await missing([id], cookie)).toEqual([id]);
    }

    expect((await block(id, false)).status).toBe(204);
    for (const { cookie } of [jin, other]) expect(new Uint8Array(await (await t.get(`files/${id}`, cookie)).arrayBuffer())).toEqual(bytes);
    expect((await block('0'.repeat(64), true)).status).toBe(204);
    expect((await t.env.db.prepare('SELECT action, target FROM admin_log ORDER BY id').all()).results).toEqual([
      { action: 'block-file', target: id },
      { action: 'unblock-file', target: id },
      { action: 'block-file', target: '0'.repeat(64) },
    ]);
  });

  it('holds upload bodies up to the budget: a ninth is not read until one of them ends', async () => {
    const { uploads } = t.env.limits;
    t.env.limits.uploads = uploadBudget(16, undefined, 16);
    const jin = await signup();
    const bytes = Array.from({ length: 9 }, (_, index) => new Uint8Array([index, 42]));
    const ids = bytes.map(sha256Hex);
    const read = new Set<number>();
    const ends: (() => void)[] = [];
    const replies = bytes.map((body, index) =>
      t.raw(`files/${ids[index]}`, {
        method: 'PUT',
        headers: { cookie: jin.cookie, 'x-account': jin.id, 'content-type': 'application/octet-stream', 'content-length': String(body.length) },
        body: new ReadableStream<Uint8Array>(
          {
            pull: (controller) => {
              if (read.has(index)) return new Promise<void>((resolve) => (ends[index] = () => resolve(controller.close())));
              read.add(index);
              controller.enqueue(body);
            },
          },
          { highWaterMark: 0 },
        ),
        duplex: 'half',
      } as RequestInit),
    );
    await vi.waitFor(() => expect(ends.filter(Boolean)).toHaveLength(8));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(read.size).toBe(8);
    const waiting = ids.findIndex((_, index) => !read.has(index));
    const first = ids.findIndex((_, index) => read.has(index));
    ends[first]!();
    expect((await replies[first]!).status).toBe(204);
    await vi.waitFor(() => expect(ends[waiting]).toBeDefined());
    ends.forEach((end, index) => index !== first && end());
    expect((await Promise.all(replies)).map(({ status }) => status)).toEqual(Array(9).fill(204));
    t.env.limits.uploads = uploads;
  });

  it('answers an upload whose body ends after its account was deleted as every request of a deleted account', async () => {
    await signup('operator');
    const jin = await signup();
    const bytes = new Uint8Array([2, 7, 1]);
    const id = sha256Hex(bytes);
    let end: (() => void) | undefined;
    const reply = t.raw(`files/${id}`, {
      method: 'PUT',
      headers: { cookie: jin.cookie, 'x-account': jin.id, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) },
      body: new ReadableStream<Uint8Array>(
        {
          pull: (controller) => {
            if (end) return;
            end = () => controller.close();
            controller.enqueue(bytes);
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: 'half',
    } as RequestInit);
    await vi.waitFor(() => expect(end).toBeDefined());
    expect((await t.delete('account', { method: 'password', proof: proof('password') }, jin.cookie)).status).toBe(204);
    await t.settle();
    end!();
    const late = await reply;
    const other = await t.post('files/missing', { ids: [id] }, jin.cookie);
    expect({ status: late.status, body: await late.json() }).toEqual({ status: other.status, body: await other.json() });
    expect(await rows(jin.incarnation)).toEqual([]);
  });

  it('answers a duplicate upload whose account began leaving while its body was on the wire as the session would', async () => {
    await signup('operator');
    const jin = await signup();
    const bytes = new Uint8Array([3, 1, 4]);
    const id = sha256Hex(bytes);
    expect((await t.put(`files/${id}`, bytes, jin.cookie)).status).toBe(204);
    let end: (() => void) | undefined;
    const reply = t.raw(`files/${id}`, {
      method: 'PUT',
      headers: { cookie: jin.cookie, 'x-account': jin.id, 'content-type': 'application/octet-stream', 'content-length': String(bytes.length) },
      body: new ReadableStream<Uint8Array>(
        {
          pull: (controller) => {
            if (end) return;
            end = () => controller.close();
            controller.enqueue(bytes);
          },
        },
        { highWaterMark: 0 },
      ),
      duplex: 'half',
    } as RequestInit);
    await vi.waitFor(() => expect(end).toBeDefined());
    // Deletion has begun and not finished: the row is still there, marked leaving.
    await t.env.db.prepare("UPDATE accounts SET state = 'leaving' WHERE incarnation = ?").bind(jin.incarnation).run();
    end!();
    expect((await reply).status).toBe(401);
    expect((await t.post('files/missing', { ids: [id] }, jin.cookie)).status).toBe(401);
  });

  it('serves a signup that reuses a client id nothing of an old upload finishing late, and the next sweep removes its bytes', async () => {
    await signup('operator');
    const old = await signup();
    const bytes = new Uint8Array([3, 1, 4]);
    const id = sha256Hex(bytes);
    const files = t.env.files;
    let reused!: Awaited<ReturnType<typeof signup>>;
    await withFilesPut(
      async (key, value) => {
        expect((await t.delete('account', { method: 'password', proof: proof('password') }, old.cookie)).status).toBe(204);
        await t.settle();
        reused = await signup(old.body.username, old.id);
        return files.put(key, value);
      },
      async () => expect((await put(id, bytes, old.cookie)).status).toBe(401),
    );
    expect(reused.incarnation).not.toBe(old.incarnation);
    expect(await rows(old.incarnation)).toEqual([]);
    expect(await stored(old.incarnation, id)).toBeDefined();

    expect(await rows(reused.incarnation)).toEqual([]);
    expect(await sum(reused.incarnation)).toBe(0);
    expect(await missing([id], reused.cookie)).toEqual([id]);
    expect((await t.get(`files/${id}`, reused.cookie)).status).toBe(404);

    expect((await t.reconcile()).removed).toEqual([`files/${old.incarnation}`]);
    expect(await stored(old.incarnation, id)).toBeUndefined();
  });

  it('in R2 keeps a deleted account’s pictures, and an orphan prefix, until the backup retention has passed since it was found', async () => {
    const s3 = await fakeS3();
    const disk = t.env.files;
    t.env.files = r2Bucket(s3.config);
    try {
      await signup('operator');
      const gone = await signup();
      const bytes = new Uint8Array([2, 7]);
      const id = sha256Hex(bytes);
      expect((await put(id, bytes, gone.cookie)).status).toBe(204);
      const deleted = Date.now();
      expect((await t.delete('account', { method: 'password', proof: proof('password') }, gone.cookie)).status).toBe(204);
      await t.settle();
      expect((await t.reconcile(deleted)).removed).toEqual([]);
      const orphan = `files/${'f'.repeat(32)}/${id}`;
      await t.env.files.put(orphan, bytes);
      expect((await t.reconcile(deleted + RETENTION_MS - 60_000)).removed).toEqual([]);
      expect([...s3.objects.keys()].sort()).toEqual([`files/${gone.incarnation}/${id}`, orphan].sort());
      expect((await t.reconcile(deleted + RETENTION_MS + 60_000)).removed).toEqual([`files/${gone.incarnation}`]);
      expect([...s3.objects.keys()]).toEqual([orphan]);
      expect((await t.reconcile(deleted + 2 * RETENTION_MS)).removed).toEqual([`files/${'f'.repeat(32)}`]);
      expect(s3.objects.size).toBe(0);
    } finally {
      t.env.files = disk;
      await s3.close();
    }
  });

  describe('the sweep', () => {
    const timeline = (incarnation: string) => t.env.db.prepare('SELECT timeline FROM accounts WHERE incarnation = ?').bind(incarnation).first<string>('timeline');
    const settle = (incarnation: string) => t.env.db.prepare('UPDATE account_files SET claimed_at = 0 WHERE incarnation = ?').bind(incarnation).run();
    const sweep = async (cookie: string, body: Record<string, unknown>) => {
      const { rev } = await (await t.get('files', cookie)).json() as { rev: number };
      return t.post('files/sweep', { rev, ...body }, cookie);
    };
    const held = async (cookie: string) => ((await (await t.get('files', cookie)).json()) as { ids: string[] }).ids;
    const removals = (incarnation: string) => t.env.db.prepare('SELECT id, removing FROM file_removals WHERE incarnation = ?').bind(incarnation).all().then(({ results }) => results);

    it('releases a settled file nothing names, but not one asked about within the hour, one a live link names, or any on another timeline', async () => {
      const jin = await signup();
      const bodies = [new Uint8Array([1]), new Uint8Array([2, 2]), new Uint8Array([3, 3, 3])];
      const [loose, asked, linked] = bodies.map(sha256Hex);
      for (const body of bodies) await put(sha256Hex(body), body, jin.cookie);
      await settle(jin.incarnation);
      expect(await missing([asked!], jin.cookie)).toEqual([]);
      await t.env.db.batch([
        t.env.db.prepare("INSERT INTO shares (id, incarnation, created_at) VALUES ('link', ?, 0)").bind(jin.incarnation),
        t.env.db.prepare("INSERT INTO share_versions (share, version, manifest, created_at) VALUES ('link', 1, ?, 0)").bind(linked!),
      ]);
      const unused = [loose, asked, linked];
      expect(await (await sweep(jin.cookie, { timeline: 'other', unused, named: [] })).json()).toEqual({ error: 'cache-reset' });
      const swept = await sweep(jin.cookie, { timeline: await timeline(jin.incarnation), unused, named: [] });
      expect(await swept.json()).toEqual({ released: 1, taken: 0 });
      expect(swept.headers.get('x-account-file-bytes')).toBe('5');
      expect(await held(jin.cookie)).toEqual([asked, linked].sort());
      expect((await t.get(`files/${loose}`, jin.cookie)).status).toBe(404);
      expect(await stored(jin.incarnation, loose!)).toBeDefined();
    });

    it('takes a released file back when an object names it or it is uploaded again, and holds the upload while its bytes go', async () => {
      const jin = await signup();
      const body = new Uint8Array([4, 5]);
      const id = sha256Hex(body);
      await put(id, body, jin.cookie);
      const release = async () => {
        await settle(jin.incarnation);
        return sweep(jin.cookie, { timeline: await timeline(jin.incarnation), unused: [id], named: [] });
      };
      await release();
      expect(await sum(jin.incarnation)).toBe(0);
      expect(await (await sweep(jin.cookie, { timeline: await timeline(jin.incarnation), unused: [], named: [id] })).json()).toEqual({ released: 0, taken: 1 });
      expect([await sum(jin.incarnation), await removals(jin.incarnation)]).toEqual([2, []]);

      await release();
      expect(await missing([id], jin.cookie)).toEqual([id]);
      await t.env.db.prepare('UPDATE file_removals SET removing = 1').run();
      expect((await put(id, body, jin.cookie)).status).toBe(503);
      await t.env.db.prepare('UPDATE file_removals SET removing = 0').run();
      await withFilesPut(async () => { throw new Error('a durable released copy must not be uploaded again'); }, async () => {
        expect((await put(id, body, jin.cookie)).status).toBe(204);
      });
      expect([await sum(jin.incarnation), await removals(jin.incarnation), await held(jin.cookie)]).toEqual([2, [], [id]]);
    });

    it('keeps a released file recoverable when its reupload cannot reserve room', async () => {
      const jin = await signup();
      const body = new Uint8Array([7, 8, 9]);
      const id = sha256Hex(body);
      await put(id, body, jin.cookie);
      await settle(jin.incarnation);
      const line = await timeline(jin.incarnation);
      await sweep(jin.cookie, { timeline: line, unused: [id], named: [] });
      await t.env.db.prepare('UPDATE service SET account_file_bytes_cap = 0').run();
      expect((await put(id, body, jin.cookie)).status).toBe(413);
      expect(await removals(jin.incarnation)).toEqual([{ id, removing: 0 }]);
      expect(await sum(jin.incarnation)).toBe(0);
      expect(await (await sweep(jin.cookie, { timeline: line, unused: [], named: [id] })).json()).toEqual({ released: 0, taken: 1 });
      expect([await sum(jin.incarnation), await stored(jin.incarnation, id)]).toEqual([3, body.buffer]);
    });

    it('does not release an unfinished reservation or turn it into a stored file', async () => {
      const jin = await signup();
      const body = new Uint8Array([8, 9]);
      const id = sha256Hex(body);
      await withFilesPut(async () => { throw new Error('storage unavailable'); }, async () => {
        expect((await put(id, body, jin.cookie)).status).toBe(500);
      });
      await settle(jin.incarnation);
      expect(await (await sweep(jin.cookie, { timeline: await timeline(jin.incarnation), unused: [id], named: [] })).json()).toEqual({ released: 0, taken: 0 });
      expect(await rows(jin.incarnation)).toEqual([{ size: 2, stored: 0 }]);
      expect(await removals(jin.incarnation)).toEqual([]);
      expect(await missing([id], jin.cookie)).toEqual([id]);
      expect((await put(id, body, jin.cookie)).status).toBe(204);
      expect(await stored(jin.incarnation, id)).toEqual(body.buffer);
      expect(await sum(jin.incarnation)).toBe(2);
    });
  });

});
