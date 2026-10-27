import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISITOR_HEADER } from '../contracts/http';
import { SHARE_LIMITS } from '../contracts/shares';
import { forgetOldRecords } from './admin';
import { ROW_BYTES } from './caps';
import { sha256Hex } from './http';
import { testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 3').run();
});

async function stored(bytes: number[], cookie: string) {
  const body = new Uint8Array(bytes);
  const id = sha256Hex(body);
  await t.put(`files/${id}`, body, cookie);
  return id;
}

// The operator first (the installation's first signup), then a sharer who has agreed and published a manifest naming
// one picture.
async function published() {
  const operator = await t.signUp('operator');
  const sharer = await t.signUp('sharer');
  await t.put('shares/consent', undefined, sharer.cookie);
  const manifest = await stored([1, 1, 1], sharer.cookie);
  const picture = await stored([2, 2, 2], sharer.cookie);
  const answer = await t.post('shares', { manifest, files: [picture], cover: null }, sharer.cookie);
  const { id } = (await answer.json()) as { id: string };
  return { operator, sharer, manifest, picture, id };
}

let visitor = 0;
const report = (share: string, from = `visitor-${++visitor}`) =>
  t.raw(`shares/${share}/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [VISITOR_HEADER]: from },
    body: JSON.stringify({ text: '미성년자로 보여요', link: `https://hazelle.app/s/${share}#key`, version: 1 }),
  });
const state = async (share: string) => ((await (await t.get(`shares/${share}`)).json()) as { state: string }).state;
const billed = async (cookie: string) => ((await (await t.get('session', cookie)).json()) as { session: { storage: { bytes: number } } }).session.storage.bytes;
const rows = async (share: string) => (await t.env.db.prepare('SELECT (SELECT COUNT(*) FROM shares WHERE id = ?1) AS links, (SELECT COUNT(*) FROM share_versions WHERE share = ?1) AS versions, (SELECT COUNT(*) FROM share_files WHERE share = ?1) AS files').bind(share).first())!;

describe('a share link', () => {
  it('reclaims a released picture on publication and excludes a concurrent sweep through the publication', async () => {
    const sharer = await t.signUp('sharer');
    await t.put('shares/consent', undefined, sharer.cookie);
    const manifest = await stored([1, 1, 1], sharer.cookie);
    const picture = await stored([2, 2], sharer.cookie);
    await t.env.db.prepare('UPDATE account_files SET claimed_at = 0').run();
    const inventory = await (await t.get('files', sharer.cookie)).json() as { timeline: string; rev: number };
    const body = { ...inventory, unused: [picture], named: [] };
    expect(await (await t.post('files/sweep', body, sharer.cookie)).json()).toEqual({ released: 1, taken: 0 });
    let reached!: () => void;
    const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
    let resume!: () => void;
    const resumePromise = new Promise<void>((resolve) => { resume = resolve; });
    const batch = t.env.db.batch.bind(t.env.db);
    const claimed = vi.spyOn(t.env.db, 'batch').mockImplementationOnce(async (statements) => {
      const result = await batch(statements);
      reached();
      await resumePromise;
      return result as never;
    });
    try {
      const publishing = t.post('shares', { manifest, files: [picture], cover: null }, sharer.cookie);
      await reachedPromise;
      // Even a settled claim cannot be released while its publication owns the account queue.
      await t.env.db.prepare('UPDATE account_files SET claimed_at = 0').run();
      const sweeping = t.post('files/sweep', body, sharer.cookie);
      resume();
      const published = await publishing;
      expect(published.status).toBe(201);
      const { id } = await published.json() as { id: string };
      expect(await (await sweeping).json()).toEqual({ released: 0, taken: 0 });
      expect((await t.get(`shares/${id}/files/${picture}`)).status).toBe(200);
      expect((await t.env.db.prepare('SELECT id FROM file_removals').all()).results).toEqual([]);
      expect(await t.env.db.prepare('SELECT file_bytes FROM accounts').first('file_bytes')).toBe(5);
    } finally {
      resume();
      claimed.mockRestore();
    }
  });

  it('is held by its first report, both anonymous reads answer held, and once reviewed a report no longer holds it', async () => {
    const { operator, sharer, picture, id } = await published();
    expect(await state(id)).toBe('live');
    expect((await t.get(`shares/${id}/files/${picture}`)).status).toBe(200);

    expect((await report(id)).status).toBe(204);
    expect(await state(id)).toBe('held');
    const file = await t.get(`shares/${id}/files/${picture}`);
    expect([file.status, await file.json()]).toEqual([403, { error: 'share-held' }]);

    expect((await t.post(`admin/shares/${id}/release`, undefined, operator.cookie)).status).toBe(204);
    expect(await state(id)).toBe('live');
    expect((await report(id)).status).toBe(204);
    expect(await state(id)).toBe('live');
    const inbox = (await (await t.get('admin/reports', operator.cookie)).json()) as { reports: { resolvedAt: number | null; shared: { reviewed: boolean } }[] };
    expect(inbox.reports.map(({ resolvedAt, shared }) => [resolvedAt === null, shared.reviewed])).toEqual([[true, true], [false, true]]);

    const next = { manifest: await stored([4, 4, 4], sharer.cookie), files: [picture], cover: null };
    expect((await t.post(`shares/${id}/versions`, next, sharer.cookie)).status).toBe(200);
    expect((await report(id)).status).toBe(204);
    expect(await state(id)).toBe('held');
  });

  it("blocks the reviewed version's files for every account on a block, and refuses them in a publish after", async () => {
    const { operator, sharer, manifest, picture, id } = await published();
    await report(id);
    const blocked = await t.post(`admin/shares/${id}/block`, { version: 1, notice: '미성년자 성적 묘사로 차단했어요.', suspend: true }, operator.cookie);
    expect(blocked.status).toBe(204);
    expect(await t.env.db.prepare('SELECT id FROM file_blocks').all()).toMatchObject({ results: [{ id: picture }] });
    expect(await state(id)).toBe('gone');
    expect((await t.get(`files/${picture}`, sharer.cookie)).status).toBe(403);

    const again = await t.post('shares', { manifest, files: [picture], cover: null }, operator.cookie);
    expect([again.status, await again.json()]).toEqual([403, { error: 'no-consent' }]);
    await t.put('shares/consent', undefined, operator.cookie);
    const own = await stored([2, 2, 2], operator.cookie);
    expect(own).toBe(picture);
    const refused = await t.post('shares', { manifest: await stored([3], operator.cookie), files: [picture], cover: null }, operator.cookie);
    expect([refused.status, await refused.json()]).toEqual([403, { error: 'file-blocked' }]);
  });

  it('keeps its manifest for the operator when the sharer cuts it under an open report, until the report is resolved', async () => {
    const { operator, sharer, manifest, id } = await published();
    await report(id);
    expect((await t.delete(`shares/${id}`, undefined, sharer.cookie)).status).toBe(204);
    expect(await state(id)).toBe('gone');
    expect((await t.get(`shares/${id}/files/${manifest}`)).status).toBe(404);
    const opened = await t.get(`admin/shares/${id}/files/${manifest}`, operator.cookie);
    expect([opened.status, [...new Uint8Array(await opened.arrayBuffer())]]).toEqual([200, [1, 1, 1]]);
    const reported = await t.env.db.prepare('SELECT id FROM reports WHERE share = ?').bind(id).first<number>('id');
    expect((await t.post(`admin/reports/${reported}/resolve`, {}, operator.cookie)).status).toBe(204);
    await forgetOldRecords(t.env.db);
    // The resolved report still names the link, so its own row stays.
    expect(await rows(id)).toEqual({ links: 1, versions: 0, files: 0 });
    expect(await billed(sharer.cookie)).toBe(ROW_BYTES.share);
  });

  it("bills a link's rows to its sharer, refuses a publish past the cap, and forgets them when cut", async () => {
    const { sharer, manifest, picture, id } = await published();
    expect(await billed(sharer.cookie)).toBe(ROW_BYTES.share + 2 * ROW_BYTES.shareFile);
    const second = await t.post(`shares/${id}/versions`, { manifest, files: [picture], cover: null }, sharer.cookie);
    expect(second.headers.get('x-account-bytes')).toBe(String(ROW_BYTES.share + 4 * ROW_BYTES.shareFile));
    await t.env.db.prepare('UPDATE service SET account_bytes_cap = ?').bind(ROW_BYTES.share + 5 * ROW_BYTES.shareFile).run();
    const refused = await t.post(`shares/${id}/versions`, { manifest, files: [picture], cover: null }, sharer.cookie);
    expect([refused.status, await refused.json()]).toEqual([413, { error: 'storage-full' }]);
    expect((await t.delete(`shares/${id}`, undefined, sharer.cookie)).status).toBe(204);
    expect(await rows(id)).toEqual({ links: 0, versions: 0, files: 0 });
    expect(await billed(sharer.cookie)).toBe(0);
  });

  it('limits the links an account holds, the versions of a link and the publishes an hour', async () => {
    const { sharer, manifest, picture, id } = await published();
    const version = () => t.post(`shares/${id}/versions`, { manifest, files: [picture], cover: null }, sharer.cookie);
    const from = (last: number) => JSON.stringify(Array.from({ length: last - 1 }, (_, at) => at + 2));
    await t.env.db.prepare('INSERT INTO share_versions (share, version, manifest, created_at) SELECT ?1, value, ?2, 0 FROM json_each(?3)').bind(id, manifest, from(SHARE_LIMITS.versions)).run();
    expect(await (await version()).json()).toEqual({ error: 'too-many-versions' });
    await t.env.db.prepare("INSERT INTO shares (id, incarnation, created_at) SELECT printf('%016d', value), ?1, 0 FROM json_each(?2)").bind(sharer.incarnation, from(SHARE_LIMITS.links)).run();
    const link = await t.post('shares', { manifest, files: [picture], cover: null }, sharer.cookie);
    expect([link.status, await link.json()]).toEqual([429, { error: 'too-many-shares' }]);
    for (let sent = 3; sent < SHARE_LIMITS.publishesPerHour; sent++) await t.post('shares', 'not a version', sharer.cookie);
    const throttled = await t.post('shares', 'not a version', sharer.cookie);
    expect([throttled.status, await throttled.json()]).toEqual([429, { error: 'too-many-publishes', retryAfter: expect.any(Number) }]);
  });

  it("reads as held, cover and files too, while its sharer is suspended, and comes back when the suspension lifts", async () => {
    const { operator, sharer, picture, id } = await published();
    await t.put(`shares/${id}/cover`, { cover: { name: 'Sora', creator: 'jin', line: '연을 만들어요' } }, sharer.cookie);
    const suspended = (on: boolean) => t.put(`admin/accounts/${sharer.id}/suspended`, on ? { suspended: true, reason: '확인 중이에요.' } : { suspended: false }, operator.cookie);
    expect((await suspended(true)).status).toBe(204);
    const cover = async () => ((await (await t.get(`shares/${id}/cover`)).json()) as { cover: unknown }).cover;
    expect([await state(id), await cover(), (await t.get(`shares/${id}/files/${picture}`)).status]).toEqual(['held', null, 403]);
    expect((await suspended(false)).status).toBe(204);
    expect([await state(id), await cover(), (await t.get(`shares/${id}/files/${picture}`)).status]).toEqual(['live', { name: 'Sora', creator: 'jin', line: '연을 만들어요' }, 200]);
  });

  it('limits each visitor of the anonymous routes on its own', async () => {
    const { id, operator } = await published();
    await t.post(`admin/shares/${id}/release`, undefined, operator.cookie);
    const statuses = [];
    for (let sent = 0; sent < 7; sent++) statuses.push((await report(id, 'one visitor')).status);
    expect(statuses).toEqual([204, 204, 204, 204, 204, 204, 429]);
    expect((await report(id, 'another visitor')).status).toBe(204);
  });

  it('counts its 받은 횟수 once a day per visitor', async () => {
    const { id } = await published();
    const receive = (from: string) => t.raw(`shares/${id}/received`, { method: 'POST', headers: { 'content-type': 'application/json', [VISITOR_HEADER]: from } });
    for (const from of ['one', 'one', 'two']) expect((await receive(from)).status).toBe(204);
    expect(await t.env.db.prepare('SELECT received FROM shares WHERE id = ?').bind(id).first('received')).toBe(2);
  });
});
