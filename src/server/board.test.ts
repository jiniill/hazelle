import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { COMMENTS_PER_DAY, GUEST_ADDRESS_CAP_MULTIPLIER, GUEST_BOARD_HEADER, MAX_DIAGNOSTICS_LENGTH, MAX_PICTURE_BYTES, MAX_POST_PICTURES, PICTURES_PER_DAY, POSTS_PER_DAY, type Activity, type Compose, type Post, type PostList } from '../contracts/board';
import { UNREAD_BOARD_HEADER, VISITOR_HEADER } from '../contracts/http';
import { sha256Hex } from './http';
import { forgetOldRecords } from './admin';
import { beginRestore } from './lifecycle';
import { testApp } from './testing';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  await t.env.db.prepare('UPDATE service SET signup_cap = 10').run();
});

type Who = { id: string; cookie: string };
// The first signup of an installation is its operator, so a test calls this before member().
const operator = () => t.signUp('operator');
async function member(name: string) {
  const who = await t.signUp();
  expect((await t.put('board/name', { name }, who.cookie)).status).toBe(204);
  return who;
}
const write = (who: Who, compose: Partial<Compose> = {}) => t.post('board/posts', { title: '제목', text: '본문', category: 'idea', visibility: 'public', diagnostics: null, ...compose }, who.cookie);
const posted = async (who: Who, compose: Partial<Compose> = {}) => ((await (await write(who, compose)).json()) as { id: number }).id;
const list = async (who: Who, query = 'sort=new') => (await (await t.get(`board/posts?${query}`, who.cookie)).json()) as PostList;
const titles = async (who: Who, query?: string) => (await list(who, query)).posts.map(({ title }) => title);
const read = async (who: Who, id: number) => ((await (await t.get(`board/posts/${id}`, who.cookie)).json()) as { post: Post }).post;
const comment = async (who: Who, post: number, text: string, parentId: number | null = null) => t.post(`board/posts/${post}/comments`, { text, parentId }, who.cookie);
const commented = async (who: Who, post: number, text: string, parentId: number | null = null) => ((await (await comment(who, post, text, parentId)).json()) as { comment: { id: number } }).comment.id;
const log = async (who: Who) => ((await (await t.get('admin/log', who.cookie)).json()) as { log: { action: string; target: string; detail: unknown }[] }).log;

it('asks for a nickname before the first post, unique ignoring case and spacing, and never one that reads as the operator', async () => {
  await operator();
  const first = await t.signUp();
  expect(await (await t.get('board/name', first.cookie)).json()).toEqual({ name: null });
  expect((await write(first)).status).toBe(403);
  for (const name of ['a', ' 앞공백', 'a@b', '두  칸']) expect(await (await t.put('board/name', { name }, first.cookie)).json()).toEqual({ error: 'bad-nickname' });
  expect((await t.put('board/name', { name: '운영자' }, first.cookie)).status).toBe(409);
  expect((await t.put('board/name', { name: 'Hazel Fan' }, first.cookie)).status).toBe(204);
  expect((await t.put('board/name', { name: 'Hazel Fan' }, first.cookie)).status).toBe(204);
  expect(await (await t.get('board/name', first.cookie)).json()).toEqual({ name: 'Hazel Fan' });
  expect((await write(first)).status).toBe(200);

  const second = await t.signUp();
  expect(await (await t.put('board/name', { name: 'hazel fan' }, second.cookie)).json()).toEqual({ error: 'nickname-taken' });
});

it('gives the operator no nickname: it writes as 운영자 without one', async () => {
  const admin = await operator();
  expect(await (await t.get('board/name', admin.cookie)).json()).toEqual({ name: '운영자' });
  expect((await t.put('board/name', { name: '진짜운영자' }, admin.cookie)).status).toBe(400);
  const id = await posted(admin, { title: '공지' });
  const reader = await member('reader');
  expect((await read(reader, id)).author).toEqual({ name: '운영자', operator: true, mine: false, left: false });
});

it('keeps 소식 to the operator, public and without a status, and out of the feed that names no category', async () => {
  const admin = await operator();
  const reader = await member('reader');
  expect((await write(reader, { category: 'news' })).status).toBe(400);
  expect((await write(admin, { category: 'news', visibility: 'operator' })).status).toBe(400);
  const news = await posted(admin, { title: '소식', category: 'news' });
  const idea = await posted(reader, { title: '제안' });
  expect((await t.put(`board/posts/${idea}`, { title: '제안', text: '본문', category: 'news' }, reader.cookie)).status).toBe(400);
  expect((await t.put(`board/posts/${news}/status`, { status: 'done', version: null }, admin.cookie)).status).toBe(404);
  expect(await titles(reader)).toEqual(['제안']);
  expect(await titles(reader, 'sort=new&category=news')).toEqual(['소식']);
});

it('lists a public post to every account and an operator-only one to its author and the operator alone', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  await posted(author, { title: '공개' });
  const asked = await posted(author, { title: '비공개', visibility: 'operator' });

  expect(await titles(other)).toEqual(['공개']);
  expect(await titles(other, 'sort=new&visibility=operator')).toEqual([]);
  expect((await t.get(`board/posts/${asked}`, other.cookie)).status).toBe(404);
  expect(await titles(author, 'sort=new&mine=1')).toEqual(['비공개', '공개']);
  expect(await titles(admin, 'sort=new&visibility=operator')).toEqual(['비공개']);
  expect((await list(author)).posts[0]).toMatchObject({ author: { name: 'author', operator: false, mine: true }, votes: 0, voted: false, commentCount: 0, hidden: null, deleted: false });
});

it("opens the public reads to a page stating no account, as no one's, whatever cookie it carries", async () => {
  await operator();
  const author = await member('author');
  const id = await posted(author, { title: '공개' });
  await posted(author, { title: '비공개', visibility: 'operator' });
  await commented(author, id, '댓글');
  // An author who left: its rows must not read as the visitor's own.
  await t.env.db.prepare('UPDATE posts SET account_id = NULL').run();
  await t.env.db.prepare('UPDATE comments SET account_id = NULL').run();

  const visitor = (path: string) => t.get(path, undefined, { cookie: author.cookie });
  const { posts } = (await (await visitor('board/posts?sort=new')).json()) as PostList;
  expect(posts.map(({ title, author: by }) => [title, by.mine, by.left])).toEqual([['공개', false, true]]);
  const { post } = (await (await visitor(`board/posts/${id}`)).json()) as { post: Post };
  expect([post.author.mine, post.comments.map(({ author: by }) => by.mine)]).toEqual([false, [false]]);
  expect((await visitor('board/name')).status).toBe(400);
});

it('lets a suspended account write and read only operator-only posts', async () => {
  const admin = await operator();
  const writer = await member('writer');
  const suspended = await member('suspended');
  await posted(writer, { title: '공개' });
  const before = await posted(suspended, { title: '정지 전에 쓴 글' });
  await commented(admin, before, '정지 뒤에 달린 댓글');
  await t.env.db.prepare('UPDATE accounts SET suspended_at = 1 WHERE id = ?').bind(suspended.id).run();

  expect(await (await write(suspended)).json()).toEqual({ error: 'suspended' });
  expect((await write(suspended, { title: '지워 주세요', visibility: 'operator' })).status).toBe(200);
  expect(await titles(suspended)).toEqual([]);
  expect(await titles(suspended, 'sort=new&mine=1')).toEqual(['지워 주세요']);
  // What happened on its public posts stays out of its activity and its unread count, and it deletes only what it reads.
  expect(await (await t.get('board/activity', suspended.cookie)).json()).toEqual({ activity: [], next: null });
  expect(await (await t.get('session', suspended.cookie)).json()).toMatchObject({ session: { unreadBoard: 0 } });
  expect((await t.delete(`board/posts/${before}`, undefined, suspended.cookie)).status).toBe(404);
});

it("sorts 'top' by votes, then newest, and pages it on the server's cursor", async () => {
  await operator();
  const author = await member('author');
  const voters = [await member('one'), await member('two')];
  const [a, b, c] = [await posted(author, { title: 'a' }), await posted(author, { title: 'b' }), await posted(author, { title: 'c' })];
  for (const voter of voters) await t.put(`board/posts/${a}/vote`, { voted: true }, voter.cookie);
  await t.put(`board/posts/${c}/vote`, { voted: true }, voters[0]!.cookie);

  const first = await list(author, 'sort=top&limit=2');
  expect([first.posts.map(({ title }) => title), first.next]).toEqual([['a', 'c'], `1:${c}`]);
  expect(await titles(author, `sort=top&limit=2&after=${first.next}`)).toEqual(['b']);
  expect(b).toBeLessThan(c);
  expect((await t.get('board/posts?sort=top&after=12', author.cookie)).status).toBe(400);
});

it('counts one vote per account, taken back by voting false, and refuses votes on an operator-only post', async () => {
  await operator();
  const author = await member('author');
  const voter = await member('voter');
  const id = await posted(author);
  for (const voted of [true, true]) expect(await (await t.put(`board/posts/${id}/vote`, { voted }, voter.cookie)).json()).toEqual({ votes: 1 });
  expect(await (await t.put(`board/posts/${id}/vote`, { voted: true }, author.cookie)).json()).toEqual({ votes: 2 });
  expect((await list(voter)).posts[0]).toMatchObject({ votes: 2, voted: true });
  expect(await (await t.put(`board/posts/${id}/vote`, { voted: false }, voter.cookie)).json()).toEqual({ votes: 1 });

  const asked = await posted(author, { visibility: 'operator' });
  expect((await t.put(`board/posts/${asked}/vote`, { voted: true }, author.cookie)).status).toBe(400);
});

it('keeps comments flat with one level of 답글: a 답글 to a 답글 joins the top-level thread', async () => {
  const admin = await operator();
  const author = await member('author');
  const id = await posted(author);
  const top = await commented(author, id, '첫 댓글');
  const reply = await commented(admin, id, '답글', top);
  await commented(author, id, '답글의 답글', reply);
  expect((await comment(author, id, '없는 댓글에', 999)).status).toBe(400);

  const post = await read(author, id);
  expect(post.comments.map(({ text, parentId }) => [text, parentId])).toEqual([['첫 댓글', null], ['답글', top], ['답글의 답글', top]]);
  expect(post.commentCount).toBe(3);
});

it("keeps comments and 답글 to the post's author and the operator, and 소식 to the operator alone", async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author);
  const byAuthor = await commented(author, id, '글쓴이 댓글');
  const byOperator = await commented(admin, id, '운영자 댓글');
  for (const parent of [null, byAuthor, byOperator]) expect(await (await comment(other, id, '끼어들기', parent)).json()).toEqual({ error: 'not-author' });
  expect((await comment(author, id, '운영자에게', byOperator)).status).toBe(200);
  expect((await comment(admin, id, '글쓴이에게', byAuthor)).status).toBe(200);
  const before = await t.env.db.prepare('INSERT INTO comments (post_id, account_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING id').bind(id, other.id, '규칙 전 댓글', Date.now()).first<number>('id');
  expect((await comment(author, id, '답', before)).status).toBe(200);
  const news = await posted(admin, { category: 'news' });
  expect(await (await comment(other, news, '소식 댓글')).json()).toEqual({ error: 'not-author' });
  expect((await comment(admin, news, '덧붙임')).status).toBe(200);
});

it("lets only the author edit a post or comment, the operator included among the others", async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author);
  const said = await commented(author, id, '처음 말');
  const edit = { title: '고친 제목', text: '고친 본문', category: 'bug' };
  for (const who of [other, admin]) {
    expect((await t.put(`board/posts/${id}`, edit, who.cookie)).status).toBe(404);
    expect((await t.put(`board/comments/${said}`, { text: '남이 고침' }, who.cookie)).status).toBe(404);
  }
  expect((await t.put(`board/posts/${id}`, edit, author.cookie)).status).toBe(204);
  expect((await t.put(`board/comments/${said}`, { text: '고친 말' }, author.cookie)).status).toBe(204);
  expect(await read(other, id)).toMatchObject({ ...edit, editedAt: expect.any(Number), comments: [{ text: '고친 말', editedAt: expect.any(Number) }] });
});

it('refuses comments on a locked post, and logs the lock', async () => {
  const admin = await operator();
  const author = await member('author');
  const id = await posted(author);
  expect((await t.put(`board/posts/${id}/locked`, { locked: true }, author.cookie)).status).toBe(403);
  expect((await t.put(`board/posts/${id}/locked`, { locked: true }, admin.cookie)).status).toBe(204);
  expect(await (await comment(author, id, '닫혔나요')).json()).toEqual({ error: 'post-locked' });
  expect((await read(author, id)).locked).toBe(true);
  expect(await log(admin)).toMatchObject([{ action: 'post-lock', target: String(id) }]);
});

it('hides a post from others but not from its author, until a hold runs out', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author, { title: '가려질 글' });
  expect((await t.put(`board/posts/${id}/hidden`, { hidden: { reason: '신고 검토 중', days: 3 } }, admin.cookie)).status).toBe(204);

  expect(await titles(other)).toEqual([]);
  expect((await t.get(`board/posts/${id}`, other.cookie)).status).toBe(404);
  expect((await read(author, id)).hidden).toEqual({ reason: '신고 검토 중', until: expect.any(Number) });
  expect(await log(admin)).toMatchObject([{ action: 'post-hide', target: String(id), detail: { reason: '신고 검토 중', days: 3 } }]);
  expect(await (await t.get('session', author.cookie)).json()).toMatchObject({ session: { unreadNotices: 1 } });
  expect(await (await t.get('notices', author.cookie)).json()).toMatchObject({ notices: [{ text: '"가려질 글" 글을 가렸어요. 이유: 신고 검토 중. 3일 뒤에 다시 보여요.' }] });

  await t.env.db.prepare('UPDATE posts SET hidden_until = ? WHERE id = ?').bind(Date.now() - 1, id).run();
  expect(await titles(other)).toEqual(['가려질 글']);
  expect((await read(author, id)).hidden).toBeNull();
});

it('hides a comment: its text reaches only its author and the operator', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const id = await posted(author);
  const said = await commented(author, id, '거친 말');
  expect((await t.put(`board/comments/${said}/hidden`, { hidden: { reason: '욕설', days: null } }, admin.cookie)).status).toBe(204);
  expect((await read(other, id)).comments[0]).toMatchObject({ text: null, hidden: null });
  expect((await read(author, id)).comments[0]).toMatchObject({ text: '거친 말', hidden: { reason: '욕설', until: null } });
  expect((await read(admin, id)).comments[0]).toMatchObject({ text: '거친 말', hidden: { reason: '욕설', until: null } });
  expect(await (await t.get('notices', author.cookie)).json()).toMatchObject({ notices: [{ text: '"제목" 글에 쓴 댓글을 가렸어요. 이유: 욕설.' }] });
  expect(await (await t.get('session', other.cookie)).json()).toMatchObject({ session: { unreadNotices: 0 } });
});

it('holds each account to its posts a day, counted in the database', async () => {
  await operator();
  const author = await member('author');
  for (let index = 0; index < POSTS_PER_DAY; index++) expect((await write(author)).status).toBe(200);
  expect(await (await write(author)).json()).toEqual({ error: 'too-many-posts' });
  await t.env.db.prepare('UPDATE posts SET created_at = created_at - 86400001').run();
  expect((await write(author)).status).toBe(200);
});

it('leaves a placeholder over the comments of a deleted post, and removes a post with none', async () => {
  const admin = await operator();
  const author = await member('author');
  const other = await member('other');
  const kept = await posted(author, { title: '댓글 있는 글' });
  const gone = await posted(author, { title: '댓글 없는 글' });
  const said = await commented(author, kept, '댓글');
  expect((await t.delete(`board/posts/${kept}`, undefined, other.cookie)).status).toBe(404);
  expect((await t.delete(`board/posts/${kept}`, undefined, author.cookie)).status).toBe(204);
  expect((await t.delete(`board/posts/${kept}`, undefined, author.cookie)).status).toBe(404);
  expect((await t.delete(`board/posts/${gone}`, undefined, admin.cookie)).status).toBe(204);

  expect(await read(other, kept)).toMatchObject({ title: '댓글 있는 글', text: null, deleted: true, comments: [{ text: '댓글' }] });
  expect((await t.get(`board/posts/${gone}`, other.cookie)).status).toBe(404);
  expect(await log(admin)).toMatchObject([{ action: 'post-delete', target: String(gone), detail: { title: '댓글 없는 글' } }]);
  // The placeholder goes with the last comment under it.
  expect((await t.delete(`board/comments/${said}`, undefined, author.cookie)).status).toBe(204);
  expect((await t.get(`board/posts/${kept}`, other.cookie)).status).toBe(404);
});

it("lists what others did to one's posts and comments, counts it unread, and marks it seen up to the newest shown", async () => {
  const admin = await operator();
  const author = await member('author');
  const id = await posted(author, { title: '내 글' });
  const mine = await commented(author, id, '내 댓글');
  await commented(author, id, '스스로 단 답글', mine);
  const top = await commented(admin, id, '운영자 댓글');
  const reply = await commented(admin, id, '운영자 답글', mine);
  await t.env.db.prepare('UPDATE comments SET created_at = id').run();
  await t.put(`board/posts/${id}/status`, { status: 'done', version: 'v0.4.0' }, admin.cookie);
  expect((await t.put(`board/posts/${id}/status`, { status: 'working', version: 'v0.4.0' }, admin.cookie)).status).toBe(400);
  const read = (await (await t.get(`board/posts/${id}`, author.cookie)).json()) as { post: Post };
  expect(read.post).toMatchObject({ status: 'done', version: 'v0.4.0', statusAt: expect.any(Number) });

  const by = { name: '운영자', operator: true, mine: false, left: false };
  const { activity, next } = (await (await t.get('board/activity', author.cookie)).json()) as { activity: Activity[]; next: string | null };
  expect([activity, next]).toEqual([
    [
      { id: id * 2 + 1, kind: 'status', postId: id, title: '내 글', by, at: expect.any(Number), commentId: null, status: 'done' },
      { id: reply * 2, kind: 'reply', postId: id, title: '내 글', by, at: reply, commentId: reply, status: null },
      { id: top * 2, kind: 'comment', postId: id, title: '내 글', by, at: top, commentId: top, status: null },
    ],
    null,
  ]);
  const page = (await (await t.get(`board/activity?limit=1&after=${reply}:${reply * 2}`, author.cookie)).json()) as { activity: Activity[] };
  expect(page.activity.map(({ id }) => id)).toEqual([top * 2]);

  await t.env.db.prepare('UPDATE accounts SET board_seen = 0').run();
  expect(await (await t.get('session', author.cookie)).json()).toMatchObject({ session: { unreadBoard: 3 } });
  expect((await t.get('objects?since=0', author.cookie)).headers.get(UNREAD_BOARD_HEADER)).toBe('3');
  expect((await t.post('board/seen', { id: reply * 2 }, author.cookie)).headers.get(UNREAD_BOARD_HEADER)).toBe('1');
  expect((await t.post('board/seen', { id: id * 2 + 1 }, author.cookie)).headers.get(UNREAD_BOARD_HEADER)).toBe('0');
});

it('takes 신고 on posts and comments into the inbox, once per reporter and target, and resolves one without a reply', async () => {
  const admin = await operator();
  const author = await member('author');
  const reporter = await member('reporter');
  const id = await posted(author, { title: '문제의 글' });
  const said = await commented(author, id, '문제의 댓글');
  for (let index = 0; index < 2; index++) expect((await t.post(`board/posts/${id}/reports`, { text: '광고예요' }, reporter.cookie)).status).toBe(204);
  expect((await t.post(`board/comments/${said}/reports`, { text: '욕이에요' }, reporter.cookie)).status).toBe(204);

  const { reports } = (await (await t.get('admin/reports', admin.cookie)).json()) as { reports: { id: number }[] };
  const row = { accountId: reporter.id, username: 'reporter', createdAt: expect.any(Number), resolvedAt: null, share: null, shareVersion: null, link: null, shared: null };
  expect(reports).toEqual([
    { ...row, id: expect.any(Number), text: '욕이에요', postId: id, commentId: said, postTitle: '문제의 글', commentText: '문제의 댓글' },
    { ...row, id: expect.any(Number), text: '광고예요', postId: id, commentId: null, postTitle: '문제의 글', commentText: null },
  ]);
  expect((await t.post(`admin/reports/${reports[0]!.id}/resolve`, { reply: '무시돼요' }, admin.cookie)).status).toBe(204);
  expect((await t.post(`admin/reports/${reports[0]!.id}/resolve`, undefined, admin.cookie)).status).toBe(404);
  expect(await log(admin)).toMatchObject([{ action: 'resolve-report', target: String(reports[0]!.id), detail: null }]);
});

it('refuses an account another 신고 while twenty of its own are open', async () => {
  await operator();
  const author = await member('author');
  const reporter = await member('reporter');
  const id = await posted(author);
  await t.env.db.batch(Array.from({ length: 20 }, () => t.env.db.prepare(`INSERT INTO reports (account_id, username, text, created_at, post_id) VALUES (?, 'r', 'x', 1, 0)`).bind(reporter.id)));
  expect(await (await t.post(`board/posts/${id}/reports`, { text: '또' }, reporter.cookie)).json()).toEqual({ error: 'too-many-reports' });
});

it("keeps an operator-only post's 문제 진단 and author's account for the operator alone", async () => {
  const admin = await operator();
  const author = await member('author');
  expect((await write(author, { diagnostics: '진단' })).status).toBe(400);
  expect((await write(author, { visibility: 'operator', diagnostics: 'x'.repeat(MAX_DIAGNOSTICS_LENGTH + 1) })).status).toBe(400);
  const id = await posted(author, { visibility: 'operator', diagnostics: '헤이젤 진단 정보' });
  expect(await read(author, id)).toMatchObject({ diagnostics: null, account: null });
  const username = (await t.env.db.prepare('SELECT username FROM accounts WHERE id = ?').bind(author.id).first<string>('username'))!;
  expect(await read(admin, id)).toMatchObject({ diagnostics: '헤이젤 진단 정보', account: { id: author.id, username } });
  expect((await comment(author, id, '추가로요')).status).toBe(200);
  expect((await commented(admin, id, '고쳤어요')) > 0).toBe(true);
});

it("anchors an operator's restore on the account's open operator-only post, dated no earlier than the account even if the clock went back", async () => {
  await operator();
  const author = await member('author');
  const created = (await t.env.db.prepare('SELECT created_at FROM accounts WHERE id = ?').bind(author.id).first<number>('created_at'))!;
  const shown = await posted(author, { title: '공개 글' });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(created - 645);
  let asked: number;
  try {
    asked = await posted(author, { title: '되돌려 주세요', visibility: 'operator' });
  } finally {
    clock.mockRestore();
  }
  expect(await t.env.db.prepare('SELECT created_at FROM posts WHERE id = ?').bind(asked).first('created_at')).toBe(created);
  expect(await beginRestore(t.env, author.id, shown, { at: created - 3_600_000 })).toEqual({ refused: 'bad-post' });
  expect(await beginRestore(t.env, author.id, asked, { at: created - 3_600_000 })).toEqual({ begun: expect.any(Number) });
});

const guest = (secret = 'a'.repeat(64), address = '123.45.67.89') => ({
  send: (method: string, path: string, body?: unknown, prove = true) => t.raw(`board/${path}`, {
    method,
    headers: { 'content-type': 'application/json', [VISITOR_HEADER]: address, ...(prove ? { [GUEST_BOARD_HEADER]: secret } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }),
});
const guestPost = (who: ReturnType<typeof guest>, compose: Partial<Compose> = {}) => who.send('POST', 'posts', { title: '손님 글', text: '본문', category: 'bug', visibility: 'public', diagnostics: null, ...compose });
const guestPosted = async (who: ReturnType<typeof guest>, compose: Partial<Compose> = {}) => ((await (await guestPost(who, compose)).json()) as { id: number }).id;
const guestTag = (secret: string) => `손님#${sha256Hex(secret).slice(0, 4)}`;
const guestRead = async (who: ReturnType<typeof guest>, id: number) => ((await (await who.send('GET', `posts/${id}`)).json()) as { post: Post }).post;

it('labels guests by browser hash regardless of address, public or operator-only, never news or account-only actions', async () => {
  const admin = await operator();
  const who = guest();
  const publicId = await guestPosted(who);
  const privateId = await guestPosted(who, { visibility: 'operator', diagnostics: '문제 진단' });
  const post = await guestRead(who, publicId);
  expect(post.author).toEqual({ name: guestTag('a'.repeat(64)), guest: true, mine: true, operator: false, left: false });
  expect(post).not.toHaveProperty('guest_secret_hash');
  const asked = await commented(admin, publicId, '확인');
  expect((await who.send('POST', `posts/${publicId}/comments`, { text: '손님 답글', parentId: asked })).status).toBe(200);
  expect(await (await t.get('board/activity', admin.cookie)).json()).toMatchObject({ activity: [{ by: { name: guestTag('a'.repeat(64)), guest: true, left: false } }] });
  expect(await (await who.send('GET', 'posts?mine=1')).json()).toMatchObject({ posts: [{ id: privateId }, { id: publicId }] });
  expect((await guestRead(who, privateId)).diagnostics).toBeNull();
  expect((await read(admin, privateId)).diagnostics).toBe('문제 진단');
  expect((await guest('b'.repeat(64)).send('GET', `posts/${privateId}`)).status).toBe(404);
  expect((await guest('b'.repeat(64)).send('GET', 'posts?visibility=operator')).status).toBe(200);
  expect((await guestPost(who, { category: 'news' })).status).toBe(400);
  for (const [method, path, body] of [
    ['PUT', `posts/${publicId}/vote`, { voted: true }], ['POST', `posts/${publicId}/reports`, { text: '신고' }],
    ['PUT', 'name', { name: '손님 이름' }], ['GET', 'activity', undefined], ['POST', 'seen', { id: 1 }],
  ] as const) expect((await who.send(method, path, body)).status).toBe(401);
  const sameAddress = guest('b'.repeat(64));
  const otherTag = (await guestRead(sameAddress, await guestPosted(sameAddress))).author.name;
  expect(otherTag).toBe(guestTag('b'.repeat(64)));
  expect(otherTag).not.toBe(post.author.name);
  for (const address of ['2001:db8:abcd::1', '::1', '12.34.56.78']) {
    const reconnected = guest('a'.repeat(64), address);
    expect((await guestRead(reconnected, await guestPosted(reconnected))).author.name).toBe(post.author.name);
  }
});

it('never treats a colliding four-character tag as ownership or a comment permission', async () => {
  const who = guest('7d'.padStart(64, '0'), '123.45.2.1');
  const other = guest('15c'.padStart(64, '0'), '123.45.2.1');
  const id = await guestPosted(who);
  const otherId = await guestPosted(other);
  expect((await guestRead(other, id)).author).toMatchObject({ name: '손님#4757', mine: false });
  expect((await guestRead(other, otherId)).author).toMatchObject({ name: '손님#4757', mine: true });
  expect((await other.send('PUT', `posts/${id}`, { title: '수정', text: '본문', category: 'bug' })).status).toBe(404);
  const top = ((await (await who.send('POST', `posts/${id}/comments`, { text: '작성자', parentId: null })).json()) as { comment: { id: number } }).comment.id;
  for (const parentId of [null, top]) expect(await (await other.send('POST', `posts/${id}/comments`, { text: '끼어들기', parentId })).json()).toEqual({ error: 'not-author' });
});

it('edits and deletes guest posts and comments only with their secret, including placeholder cleanup', async () => {
  const admin = await operator();
  const who = guest('d'.repeat(64), '123.46.1.1');
  const other = guest('e'.repeat(64), '123.46.1.1');
  const id = await guestPosted(who);
  const { comment: own } = await (await who.send('POST', `posts/${id}/comments`, { text: '댓글', parentId: null })).json() as { comment: { id: number } };
  const reply = await commented(admin, id, '답글', own.id);
  for (const [path, body] of [[`posts/${id}`, { title: '수정', text: '수정 본문', category: 'question' }], [`comments/${own.id}`, { text: '수정 댓글' }]] as const) {
    expect((await who.send('PUT', path, body, false)).status).toBe(401);
    expect((await other.send('PUT', path, body)).status).toBe(404);
    expect((await other.send('DELETE', path)).status).toBe(404);
    expect((await who.send('DELETE', path, undefined, false)).status).toBe(401);
    expect((await who.send('PUT', path, body)).status).toBe(204);
  }
  expect((await guestRead(who, id)).comments[0]).toMatchObject({ text: '수정 댓글', byAuthor: true });
  expect((await who.send('DELETE', `comments/${own.id}`)).status).toBe(204);
  expect((await who.send('DELETE', `posts/${id}`)).status).toBe(204);
  expect(await guestRead(who, id)).toMatchObject({ text: null, deleted: true, comments: [{ text: null, deleted: true }, { id: reply }] });
  expect((await t.delete(`board/comments/${reply}`, undefined, admin.cookie)).status).toBe(204);
  expect((await who.send('GET', `posts/${id}`)).status).toBe(404);
  const empty = await guestPosted(who);
  expect((await who.send('DELETE', `posts/${empty}`)).status).toBe(204);
  expect((await who.send('GET', `posts/${empty}`)).status).toBe(404);
});

it('admits guest comments and 답글 only from the actual post author and the operator, never another guest behind the same address', async () => {
  const admin = await operator();
  const who = guest('f'.repeat(64), '123.47.1.1');
  const other = guest('1'.repeat(64), '123.47.1.1');
  const id = await guestPosted(who);
  const top = await commented(admin, id, '확인');
  const reply = await who.send('POST', `posts/${id}/comments`, { text: '답글', parentId: top });
  expect(reply.status).toBe(200);
  const own = ((await reply.json()) as { comment: { id: number } }).comment.id;
  expect((await comment(admin, id, '재답글', own)).status).toBe(200);
  for (const parentId of [null, top]) expect(await (await other.send('POST', `posts/${id}/comments`, { text: '끼어들기', parentId })).json()).toEqual({ error: 'not-author' });
});

it('applies the account daily post and comment caps per browser secret, even after an address change', async () => {
  const secret = '2'.repeat(64);
  const who = guest(secret, '123.48.1.1');
  const reconnected = guest(secret, '123.48.1.2');
  const other = guest('3'.repeat(64), '123.48.1.1');
  const id = await guestPosted(who);
  for (let i = 1; i < POSTS_PER_DAY; i++) expect((await guestPost(who)).status).toBe(200);
  expect(await (await guestPost(reconnected)).json()).toEqual({ error: 'too-many-posts' });
  const otherId = await guestPosted(other);
  for (let i = 0; i < COMMENTS_PER_DAY; i++) expect((await who.send('POST', `posts/${id}/comments`, { text: '댓글', parentId: null })).status).toBe(200);
  expect(await (await reconnected.send('POST', `posts/${id}/comments`, { text: '댓글', parentId: null })).json()).toEqual({ error: 'too-many-comments' });
  expect((await other.send('POST', `posts/${otherId}/comments`, { text: '다른 손님', parentId: null })).status).toBe(200);
  await t.env.db.prepare('UPDATE posts SET created_at = ? WHERE guest_secret_hash IS NOT NULL').bind(Date.now() - 86_400_001).run();
  await t.env.db.prepare('UPDATE comments SET created_at = ? WHERE guest_secret_hash IS NOT NULL').bind(Date.now() - 86_400_001).run();
  expect((await guestPost(who)).status).toBe(200);
  expect((await who.send('POST', `posts/${id}/comments`, { text: '다음 날', parentId: null })).status).toBe(200);
});

it('bounds fresh guest secrets at one address to ten times the post and comment caps, over a rolling day', async () => {
  const who = guest('9'.repeat(64), '123.48.2.1');
  const id = await guestPosted(who);
  const source = await t.env.db.prepare('SELECT guest_address_hash FROM posts WHERE id = ?').bind(id).first<string>('guest_address_hash');
  const now = Date.now();
  await t.env.db.batch([
    ...Array.from({ length: POSTS_PER_DAY * GUEST_ADDRESS_CAP_MULTIPLIER - 2 }, (_, i) => t.env.db.prepare(
      "INSERT INTO posts (title, text, category, visibility, created_at, guest_secret_hash, guest_address_hash) VALUES ('글', '본문', 'bug', 'public', ?, ?, ?)",
    ).bind(now, sha256Hex(`post browser ${i}`), source)),
    ...Array.from({ length: COMMENTS_PER_DAY * GUEST_ADDRESS_CAP_MULTIPLIER - 1 }, (_, i) => t.env.db.prepare(
      'INSERT INTO comments (post_id, text, created_at, guest_secret_hash, guest_address_hash) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, '댓글', now, sha256Hex(`comment browser ${i}`), source)),
  ]);
  const last = guest('a'.repeat(64), '123.48.2.1');
  const fresh = guest('b'.repeat(64), '123.48.2.1');
  // fresh's own post, outside this address's count, so the comment cap is what refuses fresh below
  const freshId = (await t.env.db.prepare("INSERT INTO posts (title, text, category, visibility, created_at, guest_secret_hash) VALUES ('글', '본문', 'bug', 'public', ?, ?) RETURNING id").bind(now, sha256Hex('b'.repeat(64))).first<number>('id'))!;
  const lastId = await guestPosted(last);
  expect(await (await guestPost(fresh)).json()).toEqual({ error: 'too-many-posts' });
  expect((await last.send('POST', `posts/${lastId}/comments`, { text: '마지막 댓글', parentId: null })).status).toBe(200);
  expect(await (await fresh.send('POST', `posts/${freshId}/comments`, { text: '댓글', parentId: null })).json()).toEqual({ error: 'too-many-comments' });
  expect((await guestPost(guest('b'.repeat(64), '123.48.2.2'))).status).toBe(200);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 86_400_001);
  try {
    expect((await guestPost(fresh)).status).toBe(200);
    expect((await fresh.send('POST', `posts/${freshId}/comments`, { text: '다음 날', parentId: null })).status).toBe(200);
  } finally { clock.mockRestore(); }
});

it('permanently blocks the browser secret from either moderation menu, including after an address change', async () => {
  const admin = await operator();
  const who = guest('4'.repeat(64), '123.49.1.1');
  const id = await guestPosted(who);
  const row = await t.env.db.prepare('SELECT guest_secret_hash, guest_address_hash FROM posts WHERE id = ?').bind(id).first<{ guest_secret_hash: string; guest_address_hash: string }>();
  expect(row!.guest_secret_hash).toBe(sha256Hex('4'.repeat(64)));
  const key = await t.env.db.prepare('SELECT board_guest_key FROM service').first<string>('board_guest_key');
  expect(row!.guest_address_hash).toBe(createHmac('sha256', key!).update('123.49.1.1').digest('hex'));
  expect((await t.put(`board/posts/${id}/guest-block`, undefined, admin.cookie)).status).toBe(204);
  expect(await (await guestPost(guest('4'.repeat(64), '123.49.1.2'))).json()).toEqual({ error: 'guest-board-blocked' });
  expect((await who.send('GET', `posts/${id}`)).status).toBe(200);
  const other = guest('5'.repeat(64), '123.49.1.2');
  const otherId = await guestPosted(other);
  const comment = ((await (await other.send('POST', `posts/${otherId}/comments`, { text: '댓글', parentId: null })).json()) as { comment: { id: number } }).comment.id;
  expect((await t.put(`board/comments/${comment}/guest-block`, undefined, admin.cookie)).status).toBe(204);
  expect(await (await guestPost(guest('5'.repeat(64), '123.49.1.3'))).json()).toEqual({ error: 'guest-board-blocked' });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 86_400_000);
  try {
    expect(await (await guestPost(who)).json()).toEqual({ error: 'guest-board-blocked' });
  } finally { clock.mockRestore(); }
  expect((await write(admin)).status).toBe(200);
  expect((await log(admin)).filter(({ action }) => action === 'guest-block')).toHaveLength(2);
});

it('expires an address block exactly 24 hours after moderation, then sweeps it without forgetting the secret block', async () => {
  const admin = await operator();
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const who = guest('a'.repeat(64), '123.49.2.1');
    const newcomer = guest('b'.repeat(64), '123.49.2.1');
    const id = await guestPosted(who);
    expect((await t.put(`board/posts/${id}/guest-block`, undefined, admin.cookie)).status).toBe(204);
    expect(await (await guestPost(newcomer)).json()).toEqual({ error: 'guest-board-blocked' });
    clock.mockReturnValue(now + 86_400_000 - 1);
    expect(await (await guestPost(newcomer)).json()).toEqual({ error: 'guest-board-blocked' });
    clock.mockReturnValue(now + 86_400_000);
    expect((await guestPost(newcomer)).status).toBe(200);
    expect(await (await guestPost(who)).json()).toEqual({ error: 'guest-board-blocked' });
    await forgetOldRecords(t.env.db);
    expect(await t.env.db.prepare('SELECT COUNT(*) AS n FROM board_guest_address_blocks').first('n')).toBe(0);
    expect(await t.env.db.prepare('SELECT secret_hash FROM board_guest_blocks').first('secret_hash')).toBe(sha256Hex('a'.repeat(64)));
  } finally { clock.mockRestore(); }
});

it('closes all guest writes with the operator switch while keeping reads and account writes open', async () => {
  const admin = await operator();
  const who = guest('6'.repeat(64), '123.50.1.1');
  const id = await guestPosted(who);
  const own = ((await (await who.send('POST', `posts/${id}/comments`, { text: '댓글', parentId: null })).json()) as { comment: { id: number } }).comment.id;
  expect(await (await t.get('admin/board', admin.cookie)).json()).toEqual({ guests: true });
  expect((await t.put('admin/board', { guests: false }, admin.cookie)).status).toBe(204);
  for (const [method, path, body] of [
    ['POST', 'posts', {}], ['PUT', `posts/${id}`, {}], ['DELETE', `posts/${id}`, undefined],
    ['POST', `posts/${id}/comments`, {}], ['PUT', `comments/${own}`, {}], ['DELETE', `comments/${own}`, undefined],
  ] as const) expect(await (await who.send(method, path, body)).json()).toEqual({ error: 'guest-board-closed' });
  expect((await who.send('GET', `posts/${id}`)).status).toBe(200);
  expect((await write(admin)).status).toBe(200);
  expect((await t.put('admin/board', { guests: true }, admin.cookie)).status).toBe(204);
  expect((await guestPost(who)).status).toBe(200);
});

it('moves guest posts and comments to a session account by secret, idempotently, without requiring or inventing a nickname', async () => {
  await operator();
  const account = await t.signUp();
  const secret = '7'.repeat(64);
  const who = guest(secret, '123.51.1.1');
  const id = await guestPosted(who, { visibility: 'operator' });
  expect((await who.send('POST', `posts/${id}/comments`, { text: '댓글', parentId: null })).status).toBe(200);
  await guestPosted(guest('8'.repeat(64), '123.51.1.2'));
  for (let i = 0; i < 2; i++) expect((await t.post('board/claim', { secret }, account.cookie)).status).toBe(204);
  const post = await read(account, id);
  expect(post.author).toEqual({ name: null, operator: false, mine: true, left: false });
  expect(post.comments[0]).toMatchObject({ author: post.author, byAuthor: true });
  for (const table of ['posts', 'comments']) expect(await t.env.db.prepare(`SELECT account_id, guest_secret_hash, guest_address_hash FROM ${table} WHERE id = ?`).bind(table === 'posts' ? id : post.comments[0]!.id).first()).toEqual({ account_id: account.id, guest_secret_hash: null, guest_address_hash: null });
  expect((await who.send('GET', `posts/${id}`)).status).toBe(404);
  expect((await t.env.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE guest_secret_hash IS NOT NULL').first<number>('n'))).toBe(1);
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ');
const addPicture = (who: Who, post: number, bytes: Uint8Array = JPEG) => t.post(`board/posts/${post}/pictures`, bytes, who.cookie);
const operatorPost = (who: Who) => posted(who, { category: 'bug', visibility: 'operator' });

it('keeps a picture on an operator-only post for its author and the operator alone', async () => {
  const op = await operator();
  const author = await member('글쓴이');
  const stranger = await member('낯선이');
  const post = await operatorPost(author);
  const added = (await (await addPicture(author, post, WEBP)).json()) as { id: number; type: string };
  expect(added.type).toBe('image/webp');
  for (const who of [author, op]) {
    expect((await read(who, post)).pictures).toEqual([added]);
    const got = await t.get(`board/posts/${post}/pictures/${added.id}`, who.cookie);
    expect(got.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(WEBP);
  }
  expect((await t.get(`board/posts/${post}/pictures/${added.id}`, stranger.cookie)).status).toBe(404);
  expect((await t.get(`board/posts/${post}/pictures/${added.id}`)).status).toBe(401);
});

it('refuses a picture on a public post, on another author\'s post, and from a guest', async () => {
  await operator();
  const author = await member('글쓴이');
  const stranger = await member('낯선이');
  expect((await addPicture(author, await posted(author))).status).toBe(404);
  const post = await operatorPost(author);
  expect((await addPicture(stranger, post)).status).toBe(404);
  expect((await t.post(`board/posts/${post}/pictures`, JPEG, undefined, { [GUEST_BOARD_HEADER]: 'a'.repeat(64) })).status).toBe(401);
});

it('takes only pictures the browser draws, within the size and the counts', async () => {
  await operator();
  const author = await member('글쓴이');
  const post = await operatorPost(author);
  expect((await addPicture(author, post, new TextEncoder().encode('<svg onload="x()">'))).status).toBe(400);
  const oversized = new Uint8Array(MAX_PICTURE_BYTES + 1);
  oversized.set(JPEG);
  expect((await addPicture(author, post, oversized)).status).toBe(413);
  for (let added = 0; added < MAX_POST_PICTURES; added++) expect((await addPicture(author, post)).status).toBe(200);
  expect((await addPicture(author, post)).status).toBe(429);
  for (let added = MAX_POST_PICTURES; added < PICTURES_PER_DAY;) {
    const next = await operatorPost(author);
    for (let each = 0; each < MAX_POST_PICTURES; each++, added++) expect((await addPicture(author, next)).status).toBe(200);
  }
  expect((await addPicture(author, await operatorPost(author))).status).toBe(429);
});

it('takes the pictures with the post, also where its placeholder stays, and lets the author remove one', async () => {
  const op = await operator();
  const author = await member('글쓴이');
  const count = () => t.env.db.prepare('SELECT COUNT(*) AS n FROM post_pictures').first<number>('n');
  const bare = await operatorPost(author);
  await addPicture(author, bare);
  expect((await t.delete(`board/posts/${bare}`, undefined, author.cookie)).status).toBe(204);
  expect(await count()).toBe(0);
  const answered = await operatorPost(author);
  const { id } = (await (await addPicture(author, answered)).json()) as { id: number };
  await addPicture(author, answered);
  expect((await t.delete(`board/posts/${answered}/pictures/${id}`, undefined, op.cookie)).status).toBe(404);
  expect((await t.delete(`board/posts/${answered}/pictures/${id}`, undefined, author.cookie)).status).toBe(204);
  expect(await count()).toBe(1);
  await commented(op, answered, '봤어요');
  expect((await t.delete(`board/posts/${answered}`, undefined, author.cookie)).status).toBe(204);
  expect((await read(author, answered)).deleted).toBe(true);
  expect(await count()).toBe(0);
});
