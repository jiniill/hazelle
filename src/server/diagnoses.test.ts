import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AutoChat, AutoJob, AutoReport } from '../contracts/auto-diagnosis';
import { readAutoReport } from '../contracts/auto-diagnosis';
import { VISITOR_HEADER } from '../contracts/http';
import { forgetOldRecords } from './admin';
import { DAY_MS } from './http';
import { readDiagnoses } from './diagnoses';
import { testApp } from './testing';

const CHAT: AutoChat = {
  type: 'openrouter',
  model: 'someone-private/secret-model',
  hardContext: 100_000,
  context: 48_000,
  reply: 4000,
  messages: 180,
  character: true,
  memory: { on: true, own: false, budget: 8000, clamped: 4000, window: 12_000, batch: 4000 },
  aux: { type: 'openrouter', model: 'someone-private/secret-aux' },
  stored: { records: 4, chapters: 1, facts: 2, threads: 1 },
  work: { left: null, failed: { kind: 'invalid', reason: 'outcome', refused: false, call: { state: 'done', cut: 'length', finish: 'MAX_TOKENS', error: null, status: null, code: null, tries: 1, input: 900, cached: null, written: null, output: 400, reasoning: 20, first: 900, total: 4000 } }, chapter: null },
  last: null,
  turn: null,
  cache: null,
  gap: null,
  request: { messages: 60, dropped: 15, unseen: 0, problems: 0, covered: 100, missing: 0, slot: true, tool: false, records: { over: 4, stale: 0, forgotten: 0, deleted: 0, changed: 0, rendered: 0 }, source: 'chat', bound: 'hard-upper', multiplier: 1.2, allowance: 40_000, inputLimit: 44_000, evidence: 3, cold: false, tokens: { 'block:chat': 40000, retrieval: 10 }, lore: { fired: 1, silent: 2, invalidKeys: 0, budget: 500 }, shape: { budget: 8000, used: 4000, fixed: 500, free: 3000, state: 300, stateLimit: 1600, threads: 200, chapters: [1200], sources: [4800], records: { tokens: 6000, largest: 900 }, status: { sent: 3, chaptered: 4 }, pinned: 0, edited: 0, recalled: 0 } },
};
const REPORT: AutoReport = { event: 'memory-gap', detail: null, cause: null, version: 'v0.6.4', browser: 'chrome', major: 140, os: 'windows', mobile: false, place: null, frames: null, origin: null, screen: 'chat', page: 30, online: true, visible: true, standalone: false, cores: 8, memoryGb: 8, width: 1280, height: 800, language: 'ko-KR', chat: CHAT, job: null };

it('refuses anything off the list: a field more or less, a free word, a name where a word goes', () => {
  expect(readAutoReport(REPORT)).toEqual(REPORT);
  expect(readAutoReport({ ...REPORT, extra: 1 })).toBeNull();
  expect(readAutoReport(Object.fromEntries(Object.entries(REPORT).filter(([key]) => key !== 'detail')))).toBeNull();
  expect(readAutoReport({ ...REPORT, detail: '비밀 메시지' })).toBeNull();
  expect(readAutoReport({ ...REPORT, cause: 'Load failed' })).toBeNull();
  expect(readAutoReport({ ...REPORT, place: 'my diary.txt' })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, module: 'Koyomi' } })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, messages: '180' } })).toBeNull();
  expect(readAutoReport({ ...REPORT, frames: 'a.js:1:2 비밀 메시지' })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, turn: { reason: '비밀 메시지', tokens: null, budget: null } } })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, request: { ...CHAT.request!, tokens: { '비밀 메시지': 1 } } } })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, memory: { ...CHAT.memory, note: 'text' } } })).toBeNull();
});

let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(() => {
  vi.useRealTimers();
  t.dispose();
});

const send = (report: unknown = REPORT, agent = 'Browser', visitor = '192.0.2.1') =>
  t.post('diagnoses', report, undefined, { 'user-agent': agent, [VISITOR_HEADER]: visitor });
const stored = () => t.env.db.prepare('SELECT person, times, facts FROM auto_diagnoses').all<{ person: string; times: number; facts: string }>();

it('rejects old or unlisted causes before storage and keeps the accepted cause in the latest facts', async () => {
  const report = { ...REPORT, event: 'app-error', detail: 'TypeError', origin: 'rejection', cause: 'fetch', chat: null };
  const old = Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'cause'));
  expect((await send(old)).status).toBe(400);
  expect((await send({ ...report, cause: 'private text' })).status).toBe(400);
  expect((await stored()).results).toHaveLength(0);
  expect((await send(report)).status).toBe(204);
  expect(JSON.parse((await stored()).results[0]!.facts)).toMatchObject({ cause: 'fetch', origin: 'rejection' });
  expect((await send({ ...report, cause: 'module-import' })).status).toBe(204);
  const [row] = await readDiagnoses(t.env.db);
  expect(row).toMatchObject({ times: 2, people: 1 });
  expect(JSON.parse(row!.facts)).toMatchObject({ cause: 'module-import' });
});

it('takes a silent evaluation job by closed words and sizes, a row for each kind of job, and no free word in their place', async () => {
  const job: AutoJob = { asker: 'projection', regex: true, scope: { regex: 12, messages: 7, chars: 9000, lore: 3 }, jobs: 0, ran: 4100 };
  const report = { ...REPORT, event: 'evaluation-stuck', detail: 'display', chat: null, job };
  expect(readAutoReport(report)).toEqual(report);
  expect(readAutoReport({ ...report, detail: '비밀 봇' })).toBeNull();
  expect(readAutoReport({ ...report, job: { ...job, asker: '비밀 봇' } })).toBeNull();
  expect(readAutoReport({ ...report, job: { ...job, asker: 'my-bot' } })).toBeNull();
  expect(readAutoReport({ ...report, job: { ...job, name: 'my-bot' } })).toBeNull();
  expect(readAutoReport({ ...report, job: { ...job, scope: { ...job.scope, chars: '비밀 메시지' } } })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, work: { ...CHAT.work, failed: { ...CHAT.work.failed, refused: 'by a verdict' } } } })).toBeNull();
  expect((await send(report)).status).toBe(204);
  expect((await send({ ...report, detail: 'read', job: { ...job, asker: 'memory' } })).status).toBe(204);
  const rows = await readDiagnoses(t.env.db);
  expect(rows.map(({ event, detail }) => `${event} ${detail}`).sort()).toEqual(['evaluation-stuck display', 'evaluation-stuck read']);
  expect(JSON.parse(rows.find(({ detail }) => detail === 'display')!.facts)).toMatchObject({ job });
});

it('keeps a person to one row a day, under a hash that changes with the day and names no account', async () => {
  vi.useFakeTimers({ now: Date.parse('2026-11-02T03:00:00Z'), toFake: ['Date'] });
  expect((await send()).status).toBe(204);
  expect((await send()).status).toBe(204);
  expect((await send({ ...REPORT, extra: 1 })).status).toBe(400);
  const [today] = (await stored()).results;
  expect(today!.times).toBe(2);
  // An id no list confirms stays out: it may carry an organisation or a person.
  expect(today!.facts).not.toContain('secret-model');
  expect(today!.facts).toContain('"dropped":15');
  expect((await send(REPORT, 'Other browser')).status).toBe(204);
  expect((await readDiagnoses(t.env.db))[0]).toMatchObject({ event: 'memory-gap', version: 'v0.6.4', people: 2, times: 3 });

  vi.setSystemTime(Date.parse('2026-11-03T03:00:00Z'));
  await send();
  const people = new Set((await stored()).results.map(({ person }) => person));
  expect(people.size).toBe(3);
  expect([...people].join()).not.toContain('192.0.2.1');
});

it('forgets a report after 30 days', async () => {
  vi.useFakeTimers({ now: Date.parse('2026-11-02T03:00:00Z'), toFake: ['Date'] });
  await send();
  vi.setSystemTime(Date.now() + 29 * DAY_MS);
  await forgetOldRecords(t.env.db);
  expect((await stored()).results).toHaveLength(1);
  vi.setSystemTime(Date.now() + 2 * DAY_MS);
  await forgetOldRecords(t.env.db);
  expect((await stored()).results).toHaveLength(0);
});
