import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PULSE_HEADER, VISITOR_HEADER } from '../contracts/http';
import { pulseHeader, type PulseAnswer, type PulseRole, type PulseWeek } from '../contracts/pulse';
import { tokenBucket } from './limits';
import { forgetPulse, forwarded, type Pulse } from './pulse';
import { replyKey, testApp } from './testing';
import { readVisits } from './visits';

const request = { url: 'https://api.example.com/v1/chat', method: 'POST', headers: {}, body: '{}' };
// Wednesday 2026-10-21, 12:00 KST.
const NOON = Date.parse('2026-10-21T03:00:00Z');
// Its week's start: Monday 2026-10-19, 00:00 KST.
const WEEK_FROM = Date.parse('2026-10-18T15:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
let answers: number[] = [];

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp(async () => new Response('{}', { status: answers.shift() ?? 200, headers: { 'content-type': 'application/json', 'retry-after': '0' } }));
});
afterAll(() => t.dispose());
beforeEach(async () => {
  await t.reset();
  answers = [];
  await t.env.db.prepare('UPDATE service SET signup_cap = 100').run();
  await t.restartPulse();
  at(NOON);
});

const at = (now: number) => {
  t.clock.now = () => now;
};
const people = async (count: number) => Promise.all(Array.from({ length: count }, async () => (await t.signUp()).cookie));
const label = (role: PulseRole, type: string, model: string) => ({ [PULSE_HEADER]: pulseHeader({ kind: 'call', role, type, model }) });
const call = async (cookie: string, role: PulseRole, type: string, model: string) => {
  const answer = await t.post('relay', request, cookie, label(role, type, model));
  await answer.text();
  await t.settle();
  return answer.status;
};
const seen = async (cookies: string[]) => {
  for (const cookie of cookies) await t.get('session', cookie, { [PULSE_HEADER]: 'seen' });
  await t.settle();
};
const board = async () => ((await (await t.get('pulse')).json()) as PulseAnswer).board;
const hourCalls = async () => (await t.env.db.prepare('SELECT role, calls FROM pulse_hours').all()).results;

it('keeps daily guest replies and signups with conversions from the existing ping, even with guest rankings off', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOON);
  try {
    await t.env.db.prepare('UPDATE service SET pulse_guests = 0').run();
    const guest = crypto.randomUUID();
    const another = crypto.randomUUID();
    const ping = async (client: string, role: PulseRole = 'chat', type = 'direct') => {
      expect((await t.post('pulse/guest', { client, label: pulseHeader({ kind: 'call', role, type, model: 'model' }) })).status).toBe(204);
    };
    await ping(guest);
    await ping(guest, 'chat', 'openai');
    await ping(another, 'aux');
    await t.signUp('regular');
    await t.signUp('converted', guest);
    expect((await readVisits(t.env.db, NOON))[0]).toMatchObject({ guests: 1, accounts: 2, converted: 1 });
    const tomorrow = NOON + DAY;
    at(tomorrow);
    clock.mockReturnValue(tomorrow);
    await ping(another);
    await ping(another);
    await t.signUp('convertedtomorrow', another);
    expect((await readVisits(t.env.db, tomorrow)).slice(0, 2).map(({ guests, accounts, converted }) => ({ guests, accounts, converted }))).toEqual([
      { guests: 1, accounts: 1, converted: 1 },
      { guests: 1, accounts: 2, converted: 1 },
    ]);
    await forgetPulse(t.env.db, tomorrow + 3 * DAY);
    await t.env.db.prepare('DELETE FROM accounts').run();
    expect((await readVisits(t.env.db, tomorrow))[1]).toMatchObject({ guests: 1, accounts: 2, converted: 1 });
  } finally {
    clock.mockRestore();
  }
});

it('answers with no board before anyone is counted, cached publicly for 5 minutes', async () => {
  const answer = await t.get('pulse');
  expect(answer.headers.get('cache-control')).toBe('public, max-age=300');
  expect(await answer.json()).toEqual({ at: NOON, board: null });
});

it('shows the board from 10 people in the last 7 days and a row from 5 people on it, naming only a model a list confirms', async () => {
  const cookies = await people(10);
  await seen(cookies.slice(0, 9));
  expect(await board()).toBeNull();
  await seen(cookies);
  at(NOON + 5 * 60 * 1000);
  expect((await board())?.people).toBe(10);

  for (const cookie of cookies.slice(0, 4)) await call(cookie, 'image', 'novelai', 'nai-diffusion-5-full');
  for (const cookie of cookies.slice(0, 5)) await call(cookie, 'image', 'direct', 'nai-diffusion-5-full');
  at(NOON + 10 * 60 * 1000);
  // Four on NovelAI's V5 stay in memory alone; the five through a generic connection make 기타, never its name.
  expect((await board())?.ranking.image).toEqual({
    merged: [{ key: '', model: null, share: 1, people: 5 }],
    split: [{ key: '', model: null, type: 'direct', share: 1, people: 5 }],
  });
  await call(cookies[4]!, 'image', 'novelai', 'nai-diffusion-5-full');
  at(NOON + 15 * 60 * 1000);
  expect((await board())?.ranking.image.merged).toEqual([
    { key: 'novelai diffusion v5 full', model: 'NovelAI Diffusion V5 Full', share: 1, people: 5 },
    { key: '', model: null, share: 1, people: 5 },
  ]);
});

it('merges one model across lists by its name and ranks 대화 by the last 24 hours of replies', async () => {
  await t.env.db.prepare("INSERT INTO models_dev (list, model, name) VALUES ('openrouter', 'z-ai/glm-5.2', 'GLM-5.2'), ('deepinfra', 'zai-org/GLM-5.2', 'GLM 5.2 (latest)')").run();
  const cookies = await people(10);
  await seen(cookies);
  for (const cookie of cookies.slice(0, 3)) for (let reply = 0; reply < 4; reply++) await call(cookie, 'chat', 'openrouter', 'z-ai/glm-5.2');
  for (const cookie of cookies.slice(3, 5)) await call(cookie, 'chat', 'deepinfra', 'zai-org/GLM-5.2');
  for (const cookie of cookies.slice(5)) await call(cookie, 'chat', 'openrouter', 'someone/private-tune');
  // The hour is whole, and in the window, an hour later.
  at(NOON + HOUR);
  const answer = (await board())!;
  expect(answer.replies).toBe(20);
  expect(answer.hours.at(-1)).toEqual({ at: NOON, calls: { chat: 20, aux: 0, image: 0, embedding: 0 } });
  expect(answer.ranking.chat).toEqual({
    merged: [
      { key: 'glm 5.2', model: 'GLM-5.2', share: 14 / 19, people: 5, replies: 10 },
      { key: '', model: null, share: 5 / 19, people: 5, replies: 10 },
    ],
    split: [{ key: '', model: null, type: 'openrouter', share: 5 / 19, people: 5, replies: 10 }],
    // GLM's split rows have 3 and 2 people, so its 14 replies are 순위 밖 there.
    rest: { merged: { share: 0, replies: 0 }, split: { share: 14 / 19, replies: 10 } },
    below: { merged: [], split: [{ key: 'glm 5.2', model: 'GLM-5.2', type: 'openrouter' }, { key: 'glm 5.2', model: 'GLM 5.2', type: 'deepinfra' }] },
  });
});

it('names no 대화 row below the floor while a view holds only one, whose count the pool would be', async () => {
  await t.env.db.prepare("INSERT INTO models_dev (list, model, name) VALUES ('openrouter', 'r', 'R')").run();
  const cookies = await people(10);
  await seen(cookies);
  await call(cookies[0]!, 'chat', 'openrouter', 'r');
  at(NOON + HOUR);
  expect((await board())!.ranking.chat).toEqual({ merged: [], split: [], rest: { merged: { share: 1, replies: 0 }, split: { share: 1, replies: 0 } } });
});

it('counts a call once its provider answered 2xx, once after a stream retried', async () => {
  const [cookie] = await people(1);
  answers = [500];
  expect(await call(cookie!, 'aux', 'openai', 'gpt-5')).toBe(500);
  expect(await hourCalls()).toEqual([]);

  const stream = async (tries: number[]) => {
    answers = tries;
    const id = crypto.randomUUID();
    const started = await t.post(`streams/${id}`, { key: (await replyKey()).key, request, retry: { times: 1, statuses: [429] } }, cookie, label('aux', 'openai', 'gpt-5'));
    await started.body!.cancel();
    await t.env.streams.settled();
    await t.settle();
    return id;
  };
  await stream([429, 429]);
  expect(await hourCalls()).toEqual([]);
  const id = await stream([429, 200]);
  // A pick-up read carries no label.
  await (await t.get(`streams/${id}`, cookie)).body!.cancel();
  expect(await hourCalls()).toEqual([{ role: 'aux', calls: 1 }]);
});

it('counts the last 7 days, so a Monday keeps the week before, and closes a week once its Sunday is past', async () => {
  const cookies = await people(10);
  await seen(cookies);
  at(NOON + 5 * DAY);
  expect((await board())?.people).toBe(10);
  expect((await t.env.db.prepare('SELECT week, people FROM pulse_week').all()).results).toEqual([{ week: WEEK_FROM, people: 10 }]);
  at(NOON + WEEK);
  await seen(cookies.slice(0, 9));
  expect(await board()).toBeNull();
});

it('keeps counting across a restart, and forgets a person who left', async () => {
  const cookies = await people(10);
  await seen(cookies);
  for (const cookie of cookies.slice(0, 4)) await call(cookie, 'chat', 'direct', 'tune');
  t.restartPulse();
  await call(cookies[4]!, 'chat', 'direct', 'tune');
  at(NOON + HOUR);
  expect((await board())!.ranking.chat.merged).toEqual([{ key: '', model: null, share: 1, people: 5, replies: 10 }]);
  const [left] = (await t.env.db.prepare('SELECT account FROM pulse_replies LIMIT 1').all<{ account: string }>()).results;
  await t.env.db.prepare('DELETE FROM accounts WHERE id = ?').bind(left!.account).run();
  for (const table of ['pulse_seen', 'pulse_used', 'pulse_replies']) expect(await t.env.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE account = ?`).bind(left!.account).first('n')).toBe(0);
});

it('closes a past week into the totals that passed the floors, the names under them in order, and deletes lists past 7 days', async () => {
  await t.env.db.prepare("INSERT INTO models_dev (list, model, name) VALUES ('openrouter', 'p', 'P'), ('openrouter', 'q', 'Q')").run();
  const cookies = await people(10);
  await seen(cookies);
  for (const cookie of cookies.slice(0, 5)) await call(cookie, 'chat', 'direct', 'tune');
  await call(cookies[5]!, 'aux', 'direct', 'tune');
  for (const cookie of cookies.slice(6, 8)) await call(cookie, 'aux', 'openrouter', 'p');
  await call(cookies[8]!, 'aux', 'openrouter', 'q');
  await forgetPulse(t.env.db, NOON + WEEK);
  expect((await t.env.db.prepare('SELECT key, type, place FROM pulse_week_below ORDER BY place').all()).results).toEqual([
    { key: 'p', type: '', place: 0 },
    { key: 'p', type: 'openrouter', place: 1 },
    { key: 'q', type: '', place: 2 },
    { key: 'q', type: 'openrouter', place: 3 },
  ]);
  expect((await t.env.db.prepare('SELECT week, role, people FROM pulse_week_roles').all()).results).toEqual([{ week: WEEK_FROM, role: 'chat', people: 5 }]);
  expect((await t.env.db.prepare('SELECT role, key, type, people FROM pulse_week_models ORDER BY type').all()).results).toEqual([{ role: 'chat', key: '', type: '', people: 5 }, { role: 'chat', key: '', type: 'direct', people: 5 }]);
  for (const table of ['pulse_seen', 'pulse_used']) expect(await t.env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0);
  at(NOON + WEEK);
  await seen(cookies);
  expect((await board())!.weeks).toEqual([WEEK_FROM]);
  expect(((await (await t.get(`pulse/weeks/${WEEK_FROM}`)).json()) as PulseWeek).ranking.aux.below).toEqual({
    merged: [{ key: 'p', model: 'P' }, { key: 'q', model: 'Q' }],
    split: [{ key: 'p', model: 'P', type: 'openrouter' }, { key: 'q', model: 'Q', type: 'openrouter' }],
  });
});

it("names a merged row in the spelling most people used, not most provider uses", async () => {
  await t.env.db.prepare("INSERT INTO models_dev (list, model, name) VALUES ('openrouter', 'z-ai/glm-5.2-air', 'GLM-5.2 Air'), ('vercel', 'zai/glm-5.2-air', 'GLM-5.2 Air'), ('groq', 'glm-5.2-air', 'GLM 5.2 Air')").run();
  const cookies = await people(10);
  await seen(cookies);
  for (const cookie of cookies.slice(0, 3)) for (const [type, model] of [['openrouter', 'z-ai/glm-5.2-air'], ['vercel', 'zai/glm-5.2-air']] as const) await call(cookie, 'aux', type, model);
  for (const cookie of cookies.slice(3, 7)) await call(cookie, 'aux', 'groq', 'glm-5.2-air');
  at(NOON + 10 * 60 * 1000);
  expect((await board())!.ranking.aux.merged).toEqual([{ key: 'glm 5.2 air', model: 'GLM 5.2 Air', share: 1, people: 7 }]);
});

const insert = (table: string, ...rows: (string | number | null)[][]) =>
  t.env.db.batch(rows.map((row) => t.env.db.prepare(`INSERT INTO ${table} VALUES (${row.map(() => '?').join(', ')})`).bind(...row)));
const EMPTY = { merged: [], split: [] };

it('keeps each hour 48 hours past its end, so the day before the board stays whole off the hour', async () => {
  const { id } = await t.signUp();
  for (const table of ['pulse_hours', 'pulse_replies']) {
    const row = (hour: number) => (table === 'pulse_hours' ? [hour, 'chat', 1] : [hour, '', '', id, null, 1]);
    await insert(table, row(NOON - 2 * DAY), row(NOON - 2 * DAY - HOUR));
  }
  await forgetPulse(t.env.db, NOON + 30 * 60 * 1000);
  for (const table of ['pulse_hours', 'pulse_replies']) expect((await t.env.db.prepare(`SELECT hour FROM ${table}`).all()).results).toEqual([{ hour: NOON - 2 * DAY }]);
});

it('marks 대화 against the 24 hours before, ranked as the board ranks them', async () => {
  await t.env.db.prepare("INSERT INTO models_dev (list, model, name) VALUES ('openrouter', 'a', 'A'), ('openrouter', 'b', 'B')").run();
  const cookies = await people(10);
  await seen(cookies);
  const replies = async (model: string, from: number, times: number) => {
    for (const cookie of cookies.slice(from, from + 5)) for (let reply = 0; reply < times; reply++) await call(cookie, 'chat', 'openrouter', model);
  };
  at(NOON - DAY - HOUR);
  await replies('a', 0, 2);
  await replies('b', 5, 1);
  at(NOON - HOUR);
  await replies('b', 5, 2);
  await replies('a', 0, 1);
  at(NOON + 30 * 60 * 1000);
  const answer = (await board())!;
  expect(answer.ranking.chat.merged.map((row) => row.key)).toEqual(['b', 'a']);
  expect(answer.before.chat).toEqual({ merged: [{ key: 'a' }, { key: 'b' }], split: [{ key: 'a', type: 'openrouter' }, { key: 'b', type: 'openrouter' }] });
});

it('marks the other roles against the 7 days a week earlier by people, unless those never showed the board', async () => {
  await t.env.db.prepare("INSERT INTO models_dev (list, model, name) VALUES ('openrouter', 'x', 'X'), ('openrouter', 'y', 'Y')").run();
  const cookies = await people(11);
  await seen(cookies.slice(0, 10));
  expect((await board())!.before).toEqual({ chat: EMPTY, aux: null, image: null, embedding: null });
  for (const cookie of cookies.slice(0, 5)) await call(cookie, 'aux', 'openrouter', 'x');
  for (const cookie of cookies.slice(5)) await call(cookie, 'aux', 'openrouter', 'y');
  at(NOON + WEEK);
  await seen(cookies.slice(0, 10));
  expect((await board())!.before).toEqual({
    chat: EMPTY,
    aux: { merged: [{ key: 'y' }, { key: 'x' }], split: [{ key: 'y', type: 'openrouter' }, { key: 'x', type: 'openrouter' }] },
    image: EMPTY,
    embedding: EMPTY,
  });
});

it('lists the earlier weeks and answers each by its people, against the week before it, and nothing else', async () => {
  const [last, older] = [WEEK_FROM - WEEK, WEEK_FROM - 2 * WEEK];
  await seen(await people(10));
  await insert('pulse_week', [last, 12], [older, 11]);
  await insert('pulse_week_roles', [last, 'chat', 10], [last, 'aux', 5], [older, 'chat', 8]);
  await insert('pulse_week_models', [last, 'chat', 'a', '', 'A', 6], [last, 'chat', '', '', null, 5], [last, 'aux', 'x', 'openai', 'X', 5], [older, 'chat', '', '', null, 7], [older, 'chat', 'a', '', 'A', 5]);
  expect((await board())!.weeks).toEqual([last, older]);

  const week = async (from: number | string) => t.get(`pulse/weeks/${from}`);
  const found = await week(last);
  expect(found.headers.get('cache-control')).toBe('public, max-age=86400');
  const answer = {
    from: last,
    people: 12,
    ranking: {
      chat: { merged: [{ key: 'a', model: 'A', share: 0.6, people: 6 }, { key: '', model: null, share: 0.5, people: 5 }], split: [] },
      aux: { merged: [], split: [{ key: 'x', model: 'X', type: 'openai', share: 1, people: 5 }] },
      image: EMPTY,
      embedding: EMPTY,
    },
    before: { chat: { merged: [{ key: '' }, { key: 'a' }], split: [] }, aux: EMPTY, image: EMPTY, embedding: EMPTY },
  };
  expect(await found.json()).toEqual(answer);
  expect(((await (await week(older)).json()) as { before: unknown }).before).toEqual({ chat: null, aux: null, image: null, embedding: null });
  // A past week is answered once.
  await t.env.db.prepare('DELETE FROM pulse_week_models').run();
  expect(await (await week(last)).json()).toEqual(answer);

  for (const from of ['abc', last + 1, WEEK_FROM, older - WEEK]) {
    const missing = await week(from);
    expect([from, missing.status, await missing.json()]).toEqual([from, 404, { error: 'not-found' }]);
  }
});


it('counts guest labels in the same rankings and closes their week without creating accounts', async () => {
  const cookies = await people(5);
  const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
  for (const [index, client] of ids.entries()) {
    await call(cookies[index]!, 'chat', 'direct', 'private');
    expect((await t.post('pulse/guest', { client, label: 'chat direct private' })).status).toBe(204);
  }
  // Signup keeps the guest id: crossing the account door must not add another person.
  const existing = await t.env.db.prepare('SELECT id FROM accounts LIMIT 1').first<string>('id');
  await t.post('pulse/guest', { client: existing, label: 'chat direct private' });
  at(NOON + HOUR);
  expect((await board())?.people).toBe(10);
  expect((await board())?.ranking.chat.merged).toEqual([{ key: '', model: null, share: 1, people: 10, replies: 10 }]);
  expect(await t.env.db.prepare('SELECT COUNT(*) AS n FROM accounts').first('n')).toBe(5);
  await t.restartPulse();
  expect((await board())?.people).toBe(10);
  await forgetPulse(t.env.db, NOON + WEEK);
  expect(await t.env.db.prepare('SELECT people FROM pulse_week').first('people')).toBe(10);
  expect((await t.env.db.prepare("SELECT people FROM pulse_week_models WHERE type = ''").first('people'))).toBe(10);
  for (const table of ['pulse_guest_seen', 'pulse_guest_used', 'pulse_guest_replies']) expect(await t.env.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first('n')).toBe(0);
});

it('lets only the operator persist accounts-only rankings, while guests still count as people and calls', async () => {
  const cookies = await people(10);
  for (const cookie of cookies.slice(0, 5)) await call(cookie, 'chat', 'direct', 'private');
  await seen(cookies);
  for (let index = 0; index < 5; index++) await t.post('pulse/guest', { client: crypto.randomUUID(), label: 'chat direct private' });
  at(NOON + HOUR);
  expect((await board())?.ranking.chat.merged[0]?.people).toBe(10);
  expect((await t.put('admin/pulse', { guests: false }, cookies[1])).status).toBe(403);
  expect((await t.put('admin/pulse', { guests: 'false' }, cookies[0])).status).toBe(400);
  expect((await t.put('admin/pulse', { guests: false }, cookies[0])).status).toBe(204);
  expect(await (await t.get('admin/pulse', cookies[0])).json()).toEqual({ guests: false });
  expect((await board())?.people).toBe(15);
  expect((await board())?.ranking.chat.merged).toEqual([{ key: '', model: null, share: 1, people: 5, replies: 10 }]);
  await t.restartPulse();
  expect((await board())?.ranking.chat.merged[0]?.people).toBe(5);
  expect(await t.env.db.prepare("SELECT action FROM admin_log WHERE action = 'set-pulse'").first('action')).toBe('set-pulse');
});

it('validates guest pings and limits the visitor, not a freely replaced client id', async () => {
  const previous = t.env.limits.visitors.pulse;
  t.env.limits.visitors.pulse = tokenBucket(1);
  try {
    expect((await t.post('pulse/guest', { client: 'not-a-uuid', label: 'chat direct private' }, undefined, { [VISITOR_HEADER]: 'invalid' })).status).toBe(400);
    expect((await t.post('pulse/guest', { client: crypto.randomUUID(), label: 'seen' }, undefined, { [VISITOR_HEADER]: 'seen' })).status).toBe(400);
    const ping = (visitor: string) => t.post('pulse/guest', { client: crypto.randomUUID(), label: 'chat direct private' }, undefined, { [VISITOR_HEADER]: visitor });
    expect((await ping('one')).status).toBe(204);
    expect((await ping('one')).status).toBe(429);
    expect((await ping('two')).status).toBe(204);
  } finally {
    t.env.limits.visitors.pulse = previous;
  }
});

it("counts a self-host's forwarded ping as a guest of the board, never in the daily 손님 응답", async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(NOON);
  try {
    const client = crypto.randomUUID();
    expect((await t.post('pulse/remote', { client, label: pulseHeader({ kind: 'call', role: 'chat', type: 'openai', model: 'model' }) })).status).toBe(204);
    expect((await t.env.db.prepare('SELECT account FROM pulse_guest_replies').all<{ account: string }>()).results).toEqual([{ account: `remote:${client}` }]);
    expect((await readVisits(t.env.db, NOON))[0]).toMatchObject({ guests: 0 });
  } finally {
    clock.mockRestore();
  }
});

it('forwards each counted call to the board with a hash of the person in place of its id', async () => {
  const counted: string[] = [];
  const sent: { url: string; body: unknown }[] = [];
  const pulse = forwarded({ call: async (account: string) => { counted.push(account); } } as unknown as Pulse, new URL('https://hazelle.app'), async (url, init) => {
    sent.push({ url: url.href, body: JSON.parse(init.body!) });
    return new Response(null, { status: 204 });
  });
  await pulse.call('account-1', { kind: 'call', role: 'chat', type: 'openai', model: 'gpt' });
  expect(counted).toEqual(['account-1']);
  expect(sent).toEqual([{ url: 'https://hazelle.app/api/pulse/remote', body: { client: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/), label: 'chat openai gpt' } }]);
  expect(JSON.stringify(sent)).not.toContain('account-1');
});
