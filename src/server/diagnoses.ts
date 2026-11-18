import { Hono } from 'hono';
import { AUTO_KEEP_DAYS, readAutoReport, type AutoRow } from '../contracts/auto-diagnosis';
import type { Db } from './db/service-db';
import { DAY_MS, fail, isCount, readObject, visitDay, visitorOf, type AppEnv } from './http';
import { confirmedModel } from './pulse';
import { dayHash } from './visits';

// Bounds what forged reports can fill, since the route takes no session; past it a day's reports are dropped.
const ROWS_PER_DAY = 20_000;

// No session is read here (runtime/diagnostics/auto-diagnosis sends none): a row names no account, and accounts-only is the
// client's rule, as for the pulse labels.
export const diagnoses = new Hono<AppEnv>().post('/', async (c) => {
  const visitor = visitorOf(c);
  const agent = c.req.header('user-agent') ?? '';
  if (!c.env.limits.visitors.diagnoses.limit(visitor).success) return fail(c, 429, 'too-many-visits');
  const report = readAutoReport(await readObject(c));
  if (!report) return fail(c, 400, 'bad-input');
  if (c.env.limits.visitors.diagnosers.add(visitor, agent) === 'full') return fail(c, 429, 'too-many-visits');
  const now = Date.now();
  const day = visitDay(now);
  const { rows } = (await c.env.db.prepare('SELECT COUNT(*) AS rows FROM auto_diagnoses WHERE day = ?').bind(day).first<{ rows: number }>())!;
  if (rows >= ROWS_PER_DAY) return c.body(null, 204);
  const { event, detail, cause, version, place, chat, ...device } = report;
  const model = chat?.type && chat.model ? (await confirmedModel(c.env.db, chat.type, chat.model)).name : null;
  const aux = chat?.aux.type && chat.aux.model ? (await confirmedModel(c.env.db, chat.aux.type, chat.aux.model)).name : null;
  const person = await dayHash(c.env.db, day, ['diagnosis', visitor, agent]);
  await c.env.db
    .prepare('INSERT INTO auto_diagnoses (day, person, event, detail, version, place, times, at, facts) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT DO UPDATE SET times = times + 1, at = excluded.at, facts = excluded.facts')
    .bind(day, person, event, detail ?? '', version ?? '', place ?? '', now, JSON.stringify({ ...device, cause, chat: chat && { ...chat, model, aux: { ...chat.aux, model: aux } } }))
    .run();
  return c.body(null, 204);
});

// Where a page ended: its last group's latest report and the group's own words, which break a tie between two groups
// reported in one millisecond (a group's day follows from its at).
type Place = [at: number, event: string, detail: string, version: string, place: string];

function placeOf(after: string): Place | null {
  try {
    const place: unknown = JSON.parse(after);
    return Array.isArray(place) && place.length === 5 && isCount(place[0]) && place.slice(1).every((word) => typeof word === 'string') ? (place as Place) : null;
  } catch {
    return null;
  }
}

// Newest-first keyset pages over the groups, as the operator's other lists page (admin.ts); null for an after this never gave.
// The bare facts column follows MAX(at), so a group shows its latest report (SQLite's rule for a lone MAX).
export async function readDiagnoses(db: Db, after: string | undefined, limit: number): Promise<{ rows: AutoRow[]; next: string | null } | null> {
  const from = after === undefined ? [null, null, null, null, null] : placeOf(after);
  if (!from) return null;
  const { results } = await db
    .prepare(`SELECT * FROM (SELECT day, event, detail, version, place, COUNT(*) AS people, SUM(times) AS times, MAX(at) AS at, facts FROM auto_diagnoses GROUP BY day, event, detail, version, place)
      WHERE ?1 IS NULL OR (at, event, detail, version, place) < (?1, ?2, ?3, ?4, ?5) ORDER BY at DESC, event DESC, detail DESC, version DESC, place DESC LIMIT ?6`)
    .bind(...from, limit)
    .all<AutoRow>();
  const last = results.at(-1);
  return { rows: results, next: last && results.length === limit ? JSON.stringify([last.at, last.event, last.detail, last.version, last.place] satisfies Place) : null };
}

export const forgetDiagnoses = (db: Db, now: number) => db.prepare('DELETE FROM auto_diagnoses WHERE day < ?').bind(visitDay(now) - AUTO_KEEP_DAYS * DAY_MS);
