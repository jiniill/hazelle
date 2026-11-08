import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { Notice } from '../contracts/accounts';
import { UNREAD_NOTICES_HEADER } from '../contracts/http';
import { testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 5').run();
});

// The first signup of an installation is its operator, so a test calls this before t.signUp().
const operator = () => t.signUp('operator');

const read = async (cookie: string) => ((await (await t.get('notices', cookie)).json()) as { notices: Notice[] }).notices;
const unread = async (cookie: string) => ((await (await t.get('session', cookie)).json()) as { session: { unreadNotices: number } }).session.unreadNotices;
const log = async (cookie: string) => ((await (await t.get('admin/log', cookie)).json()) as { log: { action: string; target: string; detail: unknown }[] }).log;
const stored = async () => (await t.env.db.prepare('SELECT COUNT(*) AS count FROM notices').first<number>('count'))!;

it('sends a notice to one account, which that account reads and no other does, and logs it', async () => {
  const admin = await operator();
  const to = await t.signUp('to');
  const other = await t.signUp('other');

  expect((await t.post('admin/notices', { to: to.id, text: '  점검이 끝났어요  ' }, admin.cookie)).status).toBe(204);
  expect((await t.post('admin/notices', { to: to.id, text: 'x'.repeat(2001) }, admin.cookie)).status).toBe(400);
  expect((await t.post('admin/notices', { to: crypto.randomUUID(), text: '없는 계정' }, admin.cookie)).status).toBe(404);

  expect(await read(to.cookie)).toEqual([{ id: expect.any(Number), text: '점검이 끝났어요', createdAt: expect.any(Number) }]);
  expect(await read(other.cookie)).toEqual([]);
  expect(await log(admin.cookie)).toEqual([{ id: expect.any(Number), at: expect.any(Number), action: 'send-notice', target: to.id, detail: { username: 'to' } }]);
});

it('lists a notice to everyone to the accounts there when it was sent, not to one created after', async () => {
  const admin = await operator();
  const before = await t.signUp('before');
  expect((await t.post('admin/notices', { to: null, text: '내일 점검해요' }, admin.cookie)).status).toBe(204);
  const after = await t.signUp('after');
  // Strictly later than the notice, which a signup in the same millisecond is not.
  await t.env.db.prepare('UPDATE accounts SET created_at = created_at + 1 WHERE id = ?').bind(after.id).run();

  expect(await read(before.cookie)).toMatchObject([{ text: '내일 점검해요' }]);
  expect(await read(after.cookie)).toEqual([]);
  expect(await unread(after.cookie)).toBe(0);
  expect(await log(admin.cookie)).toMatchObject([{ action: 'send-notice', target: 'everyone', detail: null }]);
});

it('counts the unread notices on the session and marks them seen up to the one the page showed', async () => {
  const admin = await operator();
  const to = await t.signUp('to');
  await t.post('admin/notices', { to: to.id, text: '하나' }, admin.cookie);
  await t.post('admin/notices', { to: null, text: '둘' }, admin.cookie);
  expect(await unread(to.cookie)).toBe(2);

  const [newest] = await read(to.cookie);
  await t.post('admin/notices', { to: to.id, text: '셋' }, admin.cookie);
  expect((await t.post('notices/seen', { id: newest!.id }, to.cookie)).status).toBe(204);
  expect(await unread(to.cookie)).toBe(1);
  // An older id never lowers what was seen.
  await t.post('notices/seen', { id: 1 }, to.cookie);
  expect(await unread(to.cookie)).toBe(1);
});

it('sends a suspension reason as a notice with the suspension, and suspends no one without a reason', async () => {
  const admin = await operator();
  const to = await t.signUp('to');
  for (const body of [{ suspended: true }, { suspended: true, reason: '  ' }]) expect((await t.put(`admin/accounts/${to.id}/suspended`, body, admin.cookie)).status).toBe(400);
  expect(await t.env.db.prepare('SELECT suspended_at FROM accounts WHERE id = ?').bind(to.id).first('suspended_at')).toBeNull();
  expect((await t.put(`admin/accounts/${to.id}/suspended`, { suspended: true, reason: '도배 때문에 멈춰요' }, admin.cookie)).status).toBe(204);
  expect((await t.put(`admin/accounts/${to.id}/suspended`, { suspended: false, reason: '   ' }, admin.cookie)).status).toBe(204);
  expect(await read(to.cookie)).toMatchObject([{ text: '도배 때문에 멈춰요' }]);
  expect((await log(admin.cookie)).map(({ action }) => action)).toEqual(['lift', 'send-notice', 'suspend']);
});

it("goes with the account it is to, so an account reusing its id reads nothing of the old one's", async () => {
  const admin = await operator();
  const gone = await t.signUp('gone');
  await t.post('admin/notices', { to: gone.id, text: '안녕히' }, admin.cookie);
  await t.post('admin/notices', { to: null, text: '모두에게' }, admin.cookie);
  expect(await stored()).toBe(2);

  expect((await t.delete(`admin/accounts/${gone.id}`, undefined, admin.cookie)).status).toBe(204);
  expect(await stored()).toBe(1);

  const again = await t.signUp('again', gone.id);
  await t.env.db.prepare('UPDATE accounts SET created_at = created_at + 1 WHERE id = ?').bind(again.id).run();
  expect(await read(again.cookie)).toEqual([]);
});

it('tells the unread count on a sync and on marking seen', async () => {
  const admin = await operator();
  const to = await t.signUp('to');
  await t.post('admin/notices', { to: to.id, text: '하나' }, admin.cookie);

  expect((await t.get('objects?since=0', to.cookie)).headers.get(UNREAD_NOTICES_HEADER)).toBe('1');
  const [notice] = await read(to.cookie);
  expect((await t.post('notices/seen', { id: notice!.id }, to.cookie)).headers.get(UNREAD_NOTICES_HEADER)).toBe('0');
});
