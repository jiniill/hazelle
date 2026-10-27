import { createHmac, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { VISITORS_PER_ADDRESS, type VisitDay } from '../contracts/admin';
import { VISITOR_HEADER } from '../contracts/http';
import type { Db } from './db/service-db';
import { transaction } from './db/transaction';
import { DAY_MS, fail, ID, readObject, visitDay, type AppEnv } from './http';
import { dailyDistinct } from './limits';

export type PageVisit = { kind: 'visit'; address: string; agent: string };
export type FrontendMessage = 'listening' | 'draining' | 'closed' | PageVisit;

// Only the API process owns these rows. The public worker sends HTML answers over IPC, never through a public route.
// A guest id is kept 7 days, the 손님 출신 window. An address adds VISITORS_PER_ADDRESS browsers a day at most, so a
// request with a made-up User-Agent cannot add rows without end.
export function openVisits(db: DatabaseSync, clock: () => number = Date.now) {
  const browsers = dailyDistinct(VISITORS_PER_ADDRESS, clock);
  const close = () => transaction(db, () => {
    db.prepare('DELETE FROM visit_hashes WHERE day < ?').run(visitDay(clock()));
    db.prepare('DELETE FROM visit_keys WHERE day < ?').run(visitDay(clock()));
    db.prepare('DELETE FROM visit_guests WHERE day < ?').run(visitDay(clock()) - 6 * DAY_MS);
  });
  close();
  return {
    close,
    page: ({ address, agent }: PageVisit) => {
      if (/bot|crawl|spider|slurp|preview/i.test(agent) || browsers.add(address, agent) === 'full') return;
      close();
      const day = visitDay(clock());
      transaction(db, () => {
        db.prepare('INSERT INTO visit_keys (day, key) VALUES (?, ?) ON CONFLICT DO NOTHING').run(day, randomBytes(32));
        const { key } = db.prepare('SELECT key FROM visit_keys WHERE day = ?').get(day) as { key: Uint8Array };
        const hash = createHmac('sha256', key).update(JSON.stringify([address, agent])).digest('hex');
        const added = db.prepare('INSERT INTO visit_hashes (day, hash) VALUES (?, ?) ON CONFLICT DO NOTHING').run(day, hash);
        db.prepare('INSERT INTO visit_days (day, visitors) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET visitors = visitors + excluded.visitors').run(day, Number(added.changes));
      });
    },
  };
}

export async function readVisits(db: Db, now = Date.now()): Promise<VisitDay[]> {
  const today = visitDay(now);
  const { results } = await db.prepare('SELECT day, visitors, guests, accounts, converted FROM visit_days WHERE day >= ? AND day <= ? ORDER BY day DESC').bind(today - 13 * DAY_MS, today).all<VisitDay>();
  const days = new Map(results.map((row) => [row.day, row]));
  return Array.from({ length: 14 }, (_, index) => {
    const day = today - index * DAY_MS;
    return days.get(day) ?? { day, visitors: 0, guests: 0, accounts: 0, converted: 0 };
  });
}

// A guest's reply (runtime/relay.ts), which never passes this server: its id is a person of the day's 손님 응답 and, at
// signup, of 손님 출신 (migrations/0027). The id is the client's to make, so an address names GUESTS_PER_ADDRESS a day.
export const guestVisits = new Hono<AppEnv>().post('/guest', async (c) => {
  const body = await readObject(c);
  const guest = typeof body?.guest === 'string' ? body.guest.toLowerCase() : '';
  if (!ID.test(guest)) return fail(c, 400, 'bad-input');
  const added = c.env.limits.visitors.guests.add(c.req.header(VISITOR_HEADER) ?? 'direct', guest);
  if (added === 'full') return fail(c, 429, 'too-many-visits');
  if (added === 'new') await c.env.db.prepare('INSERT INTO visit_guests (day, guest) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(visitDay(Date.now()), guest).run();
  return c.body(null, 204);
});
