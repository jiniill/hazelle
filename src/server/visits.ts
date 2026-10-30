import { createHmac, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { GUEST_STEPS, VISITORS_PER_ADDRESS, type GuestStep, type VisitDay } from '../contracts/admin';
import { VISITOR_HEADER } from '../contracts/http';
import type { Db } from './db/service-db';
import { transaction } from './db/transaction';
import { DAY_MS, fail, ID, readObject, visitDay, type AppEnv } from './http';
import { dailyDistinct } from './limits';

export type PageVisit = { kind: 'visit'; address: string; agent: string };
export type FrontendMessage = 'listening' | 'draining' | 'closed' | PageVisit;

// API owns visit rows; public worker reports HTML over IPC, never a public endpoint.
// Keep guest ids for the 7-day conversion window and cap distinct browsers per address/day against forged User-Agents.
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
  const { results } = await db.prepare('SELECT day, visitors, opened, connected, guests, accounts, converted FROM visit_days WHERE day >= ? AND day <= ? ORDER BY day DESC').bind(today - 13 * DAY_MS, today).all<VisitDay>();
  const days = new Map(results.map((row) => [row.day, row]));
  return Array.from({ length: 14 }, (_, index) => {
    const day = today - index * DAY_MS;
    return days.get(day) ?? { day, visitors: 0, opened: 0, connected: 0, guests: 0, accounts: 0, converted: 0 };
  });
}

// A guest's steps (runtime/relay.ts) never pass this server otherwise: its id is a person of the step's day and, for a
// reply at signup, of 손님 출신 (migrations/0029). The id is the client's to make, so an address names GUESTS_PER_ADDRESS a day.
export const guestVisits = new Hono<AppEnv>().post('/guest', async (c) => {
  const body = await readObject(c);
  const guest = typeof body?.guest === 'string' ? body.guest.toLowerCase() : '';
  const step = body?.step as GuestStep;
  if (!ID.test(guest) || !GUEST_STEPS.includes(step)) return fail(c, 400, 'bad-input');
  if (c.env.limits.visitors.guests.add(c.req.header(VISITOR_HEADER) ?? 'direct', guest) === 'full') return fail(c, 429, 'too-many-visits');
  await c.env.db.prepare('INSERT INTO visit_guests (day, guest, step) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(visitDay(Date.now()), guest, step).run();
  return c.body(null, 204);
});
