import { expect, it, vi } from 'vitest';
import type { Connection } from '../../connectors/types';
import { loadSession, markNoticesSeen, readNotices } from '../account/account';
import { readAccounts, readAdminAccount, readServiceUsage, readLog, readService, removeAccount, sendNotice, setService, suspend } from './admin';
import { markActivitySeen, readActivity, readPosts, setNickname, setPostStatus, writeComment, writePost } from './board';
import type { Restore } from '../../contracts/admin';
import { beginRestore, continueRestore, readPoints, readRestores } from '../account/restores';
import { testServer } from '../testing';

const server = testServer();

it('sets the service, suspends an account and settles its operator-only post, each read back newest first in one short page', async () => {
  const { accountId } = await server.operator();
  expect(await setService({ signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null })).toMatchObject({ ok: true });
  expect(await readService()).toEqual({
    ok: true,
    data: { signupCap: 5, accountBytesCap: 1_000_000, accountFileBytesCap: null, accounts: 1, people: 1, pending: 0, fileBytes: 0, links: 0, databaseBytes: expect.any(Number), backupAgeHours: null, diskFreePercent: expect.any(Number), warnings: expect.any(Array) },
  });

  expect(await suspend(accountId, '도배')).toMatchObject({ ok: true });
  expect(await readAccounts(null)).toMatchObject({ ok: true, data: { rows: [{ accountId, suspended: true }] } });
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { admin: true, suspended: true } } });

  const written = await writePost({ title: '그림이 이상해요', text: '그림이 이상해요', category: 'bug', visibility: 'operator', diagnostics: null });
  expect(written).toMatchObject({ ok: true });
  const post = written.ok ? written.data.id : 0;
  expect(await readService()).toMatchObject({ ok: true, data: { pending: 1 } });
  expect(await readPosts(null, { sort: 'new', visibility: 'operator' })).toMatchObject({
    ok: true,
    data: { rows: [{ id: post, title: '그림이 이상해요', visibility: 'operator', status: 'open', author: { operator: true, mine: true } }], next: null },
  });
  expect(await setPostStatus(post, 'seen', null)).toMatchObject({ ok: true });
  expect(await readService()).toMatchObject({ ok: true, data: { pending: 0 } });
  const log = await readLog(null);
  expect(log.ok && log.data.rows.map((row) => row.action)).toEqual(['post-status', 'send-notice', 'suspend', 'set-service']);
  expect(log.ok && log.data.next).toBeNull();
});

it('counts a comment on an account\'s post unread until seen, and sends notices with a reason and to everyone, read newest first', async () => {
  const operator = await server.operator();
  expect(await setService({ signupCap: 2, accountBytesCap: null, accountFileBytesCap: null })).toMatchObject({ ok: true });
  const other = await server.account('other');
  const { accountId } = other;
  expect(await setNickname('두 번째')).toMatchObject({ ok: true });
  const written = await writePost({ title: '도와주세요', text: '도와주세요', category: 'question', visibility: 'public', diagnostics: null });
  const post = written.ok ? written.data.id : 0;

  server.as(operator);
  expect(await writeComment(post, '고쳤어요', null)).toMatchObject({ ok: true });
  server.as(other);
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { unreadBoard: 1, unreadNotices: 0 } } });
  const activity = await readActivity(null);
  expect(activity).toMatchObject({ ok: true, data: { rows: [{ kind: 'comment', postId: post, title: '도와주세요', by: { operator: true } }], next: null } });
  expect(await markActivitySeen(activity.ok ? activity.data.rows[0]!.id : 0)).toMatchObject({ ok: true });
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { unreadBoard: 0 } } });

  server.as(operator);
  expect(await suspend(accountId, '잠시 멈춰요')).toMatchObject({ ok: true });
  expect(await sendNotice(null, '점검해요')).toMatchObject({ ok: true });
  server.as(other);
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { unreadNotices: 2 } } });
  const notices = await readNotices(null);
  expect(notices).toMatchObject({ ok: true, data: { rows: [{ text: '점검해요' }, { text: '잠시 멈춰요' }], next: null } });
  expect(await markNoticesSeen(notices.ok ? notices.data.rows[0]!.id : 0)).toMatchObject({ ok: true });
  expect(await loadSession()).toMatchObject({ ok: true, data: { session: { unreadNotices: 0 } } });
});

it('restores an account to a time on its operator-only post: its open device drops to the objects of that time, and the restore reads back with its undo', async () => {
  const { accountId, store, open } = await server.operator();
  const connection = (label: string): Connection => ({ type: 'openrouter', label, baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'sk-or-x' }], turns: null, starred: [] });
  const now = Date.now();
  server.at(() => now - 3_600_000);
  const kept = await store.create('connection', connection('kept'));
  await server.baseline(accountId);
  server.at(() => now - 1_800_000);
  await store.create('connection', connection('later'));
  server.at(() => Date.now());
  const written = await writePost({ title: '되돌려 주세요', text: '되돌려 주세요', category: 'question', visibility: 'operator', diagnostics: null });
  const post = written.ok ? written.data.id : 0;
  const at = now - 2_700_000;

  expect(await readPoints(accountId)).toEqual({ ok: true, data: [{ at: now - 3_600_000, takenAt: now - 3_600_000, kind: 'baseline' }] });
  const rewound = vi.fn();
  store.subscribeRewound(rewound);
  const run = await beginRestore(accountId, { post, at });
  expect(run).toEqual({ ok: true, data: { id: expect.any(Number), phase: 'done', verified: true, error: null } });
  expect(await store.pull()).toEqual({ ok: false, error: 'timeline-changed' });
  await vi.waitFor(() => expect(rewound).toHaveBeenCalledWith(0));
  const reopened = await open();
  expect(await reopened.pull()).toBeNull();
  expect(reopened.list('connection')).toEqual([kept.ok && kept.data]);

  expect(await readRestores(accountId)).toEqual({ ok: true, data: [{
    id: run.ok && run.data.id, postId: post, at, undoes: null, targetAt: now - 3_600_000, phase: 'done', verified: true, error: null,
    createdAt: expect.any(Number), updatedAt: expect.any(Number), canUndo: true, undoExpiresAt: expect.any(Number), actions: [],
  }] });
  expect(await readAccounts(null)).toMatchObject({ ok: true, data: { rows: [{ accountId, state: 'active', bytes: expect.any(Number) }], next: null } });
  const log = await readLog(null);
  expect(log.ok && log.data.rows.map((row) => row.action)).toEqual(['restore-done', 'restore-begun']);
});

function answering(...answers: Response[]) {
  const sent: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    sent.push({ url, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body as string) });
    return answers.shift()!;
  });
  return sent;
}

it('reads a bounded account page whose usage can be unknown or held', async () => {
  const unread = { accountId: 'b', username: 'bee', createdAt: 1, suspended: false, state: 'restoring', bytes: null, disk: null, fileBytes: 30, bytesCap: 'default', fileBytesCap: null };
  answering(Response.json({ accounts: [unread], next: null }));
  expect(await readAccounts(null)).toEqual({ ok: true, data: { rows: [unread], next: null } });
});

it('refreshes a single account and explicitly sums usage pages without retaining account rows', async () => {
  const totals = { bytes: 2, disk: 4, unread: 0, readAt: 10 };
  const sent = answering(
    Response.json({ account: null }),
    Response.json({ accounts: 100, totals, next: '10:account' }),
    Response.json({ accounts: 1, totals: { bytes: 0, disk: 0, unread: 1, readAt: 11 }, next: null }),
  );
  expect(await readAdminAccount('gone')).toEqual({ ok: true, data: { account: null } });
  const progress = vi.fn();
  expect(await readServiceUsage(progress, new AbortController().signal)).toEqual({ ok: true, data: { accounts: 101, bytes: 2, disk: 4, unread: 1, readAt: 10 } });
  expect(progress).toHaveBeenCalledTimes(2);
  expect(sent.map(({ url }) => url)).toEqual(['/api/admin/accounts/gone', '/api/admin/usage', '/api/admin/usage?after=10%3Aaccount']);
});

it('stops an explicit usage traversal before requesting its next page', async () => {
  const stop = new AbortController();
  const sent = answering(Response.json({ accounts: 100, totals: { bytes: 1, disk: 2, unread: 0, readAt: 3 }, next: '3:account' }));
  expect(await readServiceUsage(() => stop.abort(), stop.signal)).toEqual({ ok: false, error: 'stopped' });
  expect(sent).toHaveLength(1);
});

it('finishes a leaving account by removing it again', async () => {
  const sent = answering(new Response(null, { status: 204 }));
  expect(await removeAccount('a')).toEqual({ ok: true, data: undefined });
  expect(sent).toEqual([{ url: '/api/admin/accounts/a', method: 'DELETE', body: undefined }]);
});

it('asks a restore and an undo on a post, reads the restores with their actions, and continues one', async () => {
  const restore: Restore = {
    id: 7, postId: 3, at: 1_700_000_000_000, undoes: null, targetAt: 1_699_999_000_000, phase: 'done', verified: true, error: null,
    createdAt: 1_700_000_100_000, updatedAt: 1_700_000_200_000, canUndo: true, undoExpiresAt: 1_702_000_000_000, actions: [],
  };
  const stuck: Restore = { ...restore, id: 8, at: null, undoes: 7, phase: 'armed', error: 'rewind-pending', canUndo: false, undoExpiresAt: null, actions: ['resume'] };
  const sent = answering(
    Response.json({ id: 7, phase: 'done', verified: true, error: null }),
    Response.json({ restores: [stuck, restore] }),
    Response.json({ id: 8, phase: 'armed', verified: false, error: 'rewind-pending' }),
    Response.json({ id: 8, phase: 'done', verified: false, error: null }),
    Response.json({ error: 'bad-time' }, { status: 400 }),
  );
  expect(await beginRestore('a', { post: 3, at: restore.at! })).toEqual({ ok: true, data: { id: 7, phase: 'done', verified: true, error: null } });
  expect(await readRestores('a')).toEqual({ ok: true, data: [stuck, restore] });
  expect(await beginRestore('a', { post: 4, undoes: 7 })).toMatchObject({ ok: true, data: { phase: 'armed', error: 'rewind-pending' } });
  expect(await continueRestore('a', 8, 'resume')).toMatchObject({ ok: true, data: { phase: 'done', verified: false } });
  expect(await beginRestore('a', { post: 3, at: 1 })).toEqual({ ok: false, error: 'bad-time', retryAfter: undefined });
  expect(sent.map(({ url, method, body }) => [method, url, body])).toEqual([
    ['POST', '/api/admin/accounts/a/restores', { post: 3, at: restore.at }],
    ['GET', '/api/admin/accounts/a/restores', undefined],
    ['POST', '/api/admin/accounts/a/restores', { post: 4, undoes: 7 }],
    ['POST', '/api/admin/restores/8/resume', undefined],
    ['POST', '/api/admin/accounts/a/restores', { post: 3, at: 1 }],
  ]);
});
