import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AutoChat, AutoReport } from '../contracts/auto-diagnosis';
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
  request: { messages: 60, dropped: 15, unseen: 0, problems: 0, covered: 100, missing: 0, slot: true, tool: false, source: 'chat', bound: 'hard-upper', multiplier: 1.2, allowance: 40_000, inputLimit: 44_000, evidence: 3, cold: false },
};
const REPORT: AutoReport = { event: 'memory-gap', detail: null, version: 'v0.6.4', browser: 'chrome', major: 140, os: 'windows', mobile: false, place: null, chat: CHAT };

it('refuses anything off the list: a field more or less, a free word, a name where a word goes', () => {
  expect(readAutoReport(REPORT)).toEqual(REPORT);
  expect(readAutoReport({ ...REPORT, extra: 1 })).toBeNull();
  expect(readAutoReport(Object.fromEntries(Object.entries(REPORT).filter(([key]) => key !== 'detail')))).toBeNull();
  expect(readAutoReport({ ...REPORT, detail: '비밀 메시지' })).toBeNull();
  expect(readAutoReport({ ...REPORT, place: 'my diary.txt' })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, module: 'Koyomi' } })).toBeNull();
  expect(readAutoReport({ ...REPORT, chat: { ...CHAT, messages: '180' } })).toBeNull();
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
