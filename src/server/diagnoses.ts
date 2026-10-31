import { Hono } from 'hono';
import { AUTO_KEEP_DAYS, readAutoReport, type AutoRow } from '../contracts/auto-diagnosis';
import { VISITOR_HEADER } from '../contracts/http';
import type { Db } from './db/service-db';
import { DAY_MS, fail, readObject, visitDay, type AppEnv } from './http';
import { confirmedModel } from './pulse';
import { dayHash } from './visits';

// Bounds what forged reports can fill, since the route takes no session; past it a day's reports are dropped.
const ROWS_PER_DAY = 20_000;
const SHOWN = 200;

// No session is read here (runtime/auto-diagnosis sends none): a row names no account, and accounts-only is the
// client's rule, as for the pulse labels.
export const diagnoses = new Hono<AppEnv>().post('/', async (c) => {
  const visitor = c.req.header(VISITOR_HEADER) ?? 'direct';
  const agent = c.req.header('user-agent') ?? '';
  if (!c.env.limits.visitors.diagnoses.limit(visitor).success) return fail(c, 429, 'too-many-visits');
  const report = readAutoReport(await readObject(c));
  if (!report) return fail(c, 400, 'bad-input');
  if (c.env.limits.visitors.diagnosers.add(visitor, agent) === 'full') return fail(c, 429, 'too-many-visits');
  const now = Date.now();
  const day = visitDay(now);
  const { rows } = (await c.env.db.prepare('SELECT COUNT(*) AS rows FROM auto_diagnoses WHERE day = ?').bind(day).first<{ rows: number }>())!;
  if (rows >= ROWS_PER_DAY) return c.body(null, 204);
  const { event, detail, version, place, chat, ...device } = report;
  const model = chat?.type && chat.model ? (await confirmedModel(c.env.db, chat.type, chat.model)).name : null;
  const person = await dayHash(c.env.db, day, ['diagnosis', visitor, agent]);
  await c.env.db
    .prepare('INSERT INTO auto_diagnoses (day, person, event, detail, version, place, times, at, facts) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT DO UPDATE SET times = times + 1, at = excluded.at, facts = excluded.facts')
    .bind(day, person, event, detail ?? '', version ?? '', place ?? '', now, JSON.stringify({ ...device, chat: chat && { ...chat, model } }))
    .run();
  return c.body(null, 204);
});

// The bare facts column follows MAX(at), so a group shows its latest report (SQLite's rule for a lone MAX).
export async function readDiagnoses(db: Db): Promise<AutoRow[]> {
  const { results } = await db.prepare('SELECT day, event, detail, version, place, COUNT(*) AS people, SUM(times) AS times, MAX(at) AS at, facts FROM auto_diagnoses GROUP BY day, event, detail, version, place ORDER BY at DESC LIMIT ?').bind(SHOWN).all<AutoRow>();
  return results;
}

export const forgetDiagnoses = (db: Db, now: number) => db.prepare('DELETE FROM auto_diagnoses WHERE day < ?').bind(visitDay(now) - AUTO_KEEP_DAYS * DAY_MS);
