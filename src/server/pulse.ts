import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { CONNECTOR_MODELS, MODELS_DEV_LISTS } from '../connectors/models-dev';
import {
  pulseHeader,
  readPulseHeader,
  PULSE_FLOORS,
  PULSE_ROLES,
  type PulseAnswer,
  type PulseBelow,
  type PulseBoard,
  type PulseLabel,
  type PulseOrder,
  type PulsePlace,
  type PulseRanking,
  type PulseRankings,
  type PulseRest,
  type PulseRole,
  type PulseRow,
  type PulseWeek,
  type GuestPulse,
} from '../contracts/pulse';
import { VISITOR_HEADER } from '../contracts/http';
import type { Db } from './db/service-db';
import { DAY_MS, fail, readObject, type AppEnv } from './http';
import type { Upstream } from './relay';

// 헤이젤 나우 (design §6.12): counts what the client labels (worker.ts, calls.ts, streams.ts) and answers the public board.
// The last 7 days and the last 48 hours are lists of who used what (pulse_seen, pulse_used, pulse_replies), counted
// when read. Each day once past closes the 7 days ending it: their rank places kept for the marks, a Sunday's into the
// week's totals (pulse_week*), and the day no later window reaches deleted. The floors apply where a count is shown or
// closed, never where a call is written.

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
// 1970-01-05 00:00 KST, a Monday. Migration 0014 repeats it in SQL.
const MONDAY = 4 * DAY_MS - 9 * HOUR_MS;
const weekOf = (at: number) => at - ((((at - MONDAY) % WEEK_MS) + WEEK_MS) % WEEK_MS);
const dayOf = (at: number) => at - ((((at - MONDAY) % DAY_MS) + DAY_MS) % DAY_MS);
// The first of the 7 days ending `day`.
const firstDay = (day: number) => day - WEEK_MS + DAY_MS;
const hourOf = (at: number) => at - (at % HOUR_MS);
// How often the answer is made at most: a reload costs no read before then, and a moment shows this late.
const MEMO_MS = 5 * 60 * 1000;
const HOURS_KEPT_MS = 2 * DAY_MS;

type Call = Extract<PulseLabel, { kind: 'call' }>;

export type Pulse = {
  invalidate(): void;
  seen(account: string, guest?: boolean): Promise<void>;
  // A call its provider answered 2xx.
  call(account: string, label: Call, guest?: boolean): Promise<void>;
  answer(): Promise<PulseAnswer>;
  // null for anything but one of the board's weeks.
  week(from: number): Promise<PulseWeek | null>;
};

// key: '' for 기타, a model no list confirms, whose name may carry an organisation or a person.
type Named = { key: string; name: string | null };
const OTHER: Named = { key: '', name: null };
const BUILT_IN = new Map(Object.entries(CONNECTOR_MODELS).map(([type, models]) => [type, new Map<string, string>(models.map(({ id, name }) => [id, name]))]));

// One model, one row across lists: models.dev's names agree up to spelling. Variant words (Thinking, Fast, TEE, Pro)
// stay in the key: one that guessed which variants are the same model would be wrong somewhere.
function named(name: string): Named {
  const spelling = name.replace(/\s*\(latest\)\s*$/i, '').trim();
  return { key: spelling.toLowerCase().replace(/[\s_-]+/g, ' '), name: spelling };
}

async function confirm(db: Db, type: string, model: string): Promise<Named> {
  const listed = BUILT_IN.get(type);
  const list = MODELS_DEV_LISTS[type]?.list;
  const name = listed ? listed.get(model) : list ? await db.prepare('SELECT name FROM models_dev WHERE list = ? AND model = ?').bind(list, model).first<string>('name') : null;
  return name ? named(name) : OTHER;
}

export function openPulse(db: Db, clock: () => number = Date.now): Pulse {
  let memo: { at: number; answer: Promise<PulseAnswer> } | null = null;
  const weeks = new Map<number, Promise<PulseWeek | null>>();
  return {
    invalidate: () => { memo = null; },
    seen: async (account, guest = false) => {
      await db.prepare(`INSERT INTO ${guest ? 'pulse_guest_seen' : 'pulse_seen'} (day, account) VALUES (?, ?) ON CONFLICT DO NOTHING`).bind(dayOf(clock()), account).run();
    },
    call: async (account, { role, type, model }, guest = false) => {
      const { key, name } = await confirm(db, type, model);
      // Read after the await: a call across midnight lands in the day it ended in.
      const now = clock();
      await db.batch([
        db.prepare('INSERT INTO pulse_hours (hour, role, calls) VALUES (?, ?, 1) ON CONFLICT DO UPDATE SET calls = calls + 1').bind(hourOf(now), role),
        db.prepare(`INSERT INTO ${guest ? 'pulse_guest_used' : 'pulse_used'} (day, role, key, type, account, name) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET name = excluded.name`).bind(dayOf(now), role, key, type, account, name),
        ...(role === 'chat'
          ? [
              db
                .prepare(`INSERT INTO ${guest ? 'pulse_guest_replies' : 'pulse_replies'} (hour, key, type, account, name, replies) VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT DO UPDATE SET replies = replies + 1, name = excluded.name`)
                .bind(hourOf(now), key, type, account, name),
            ]
          : []),
      ]);
    },
    answer: () => {
      const now = clock();
      if (!memo || now - memo.at >= MEMO_MS) {
        const made = { at: now, answer: (async (): Promise<PulseAnswer> => ({ at: now, board: await board(db, now) }))() };
        made.answer.catch(() => {
          if (memo === made) memo = null;
        });
        memo = made;
      }
      return memo.answer;
    },
    week: (from) => {
      const now = clock();
      if (!Number.isSafeInteger(from) || weekOf(from) !== from || from >= weekOf(now)) return Promise.resolve(null);
      // A past week no longer changes. Only weeks found are kept: any number can be asked.
      const kept = weeks.get(from);
      if (kept) return kept;
      const made = closeDays(db, now).then(() => pastWeek(db, from));
      weeks.set(from, made);
      made.then(
        (week) => {
          if (!week) weeks.delete(from);
        },
        () => weeks.delete(from),
      );
      return made;
    },
  };
}

// type: '' for the row merged across connection types.
type WeekRow = { role: PulseRole; key: string; type: string; name: string | null; people: number };
type WeekName = Omit<WeekRow, 'people'>;
// The last 7 days counted, or a closed week as its totals are kept: what passed the floors, and the named rows under
// them in order, never counted.
type Period = { people: number; roles: Map<PulseRole, number>; models: WeekRow[]; below: WeekName[] };

const mostCounted = (names: Map<string | null, number>) => [...names].reduce<[string | null, number]>((best, each) => (each[1] > best[1] ? each : best), [null, 0])[0];
const add = <K>(map: Map<K, number>, key: K, count: number) => map.set(key, (map.get(key) ?? 0) + count);

// Most counted first; ties by name, 기타 last, then by connection type, so a place among equals tells nothing.
function sortCounted<T>(rows: T[], of: (row: T) => [count: number, name: string | null, type: string]): T[] {
  const last = '\uffff';
  return rows.sort((a, b) => {
    const [aCount, aName, aType] = of(a);
    const [bCount, bName, bType] = of(b);
    return bCount - aCount || (aName ?? last).localeCompare(bName ?? last) || aType.localeCompare(bType);
  });
}

// The lists of the 7 days ending `day` counted: each row's spelling is the one most of its people used.
async function countDays(db: Db, day: number): Promise<Period | null> {
  const days = [firstDay(day), day];
  const [seen, roles, merged, mergedNames, split] = await Promise.all([
    db.prepare('SELECT COUNT(DISTINCT account) AS people FROM pulse_people_seen WHERE day BETWEEN ? AND ?').bind(...days).first<number>('people'),
    db.prepare('SELECT role, COUNT(DISTINCT account) AS people FROM pulse_rank_used WHERE day BETWEEN ? AND ? GROUP BY role').bind(...days).all<{ role: PulseRole; people: number }>(),
    db.prepare('SELECT role, key, COUNT(DISTINCT account) AS people FROM pulse_rank_used WHERE day BETWEEN ? AND ? GROUP BY role, key').bind(...days).all<Omit<WeekRow, 'type' | 'name'>>(),
    db.prepare('SELECT role, key, name, COUNT(DISTINCT account) AS people FROM pulse_rank_used WHERE day BETWEEN ? AND ? GROUP BY role, key, name ORDER BY name').bind(...days).all<Omit<WeekRow, 'type'>>(),
    db.prepare('SELECT role, key, type, name, COUNT(DISTINCT account) AS people FROM pulse_rank_used WHERE day BETWEEN ? AND ? GROUP BY role, key, type, name ORDER BY name').bind(...days).all<WeekRow>(),
  ]);
  if (seen! < PULSE_FLOORS.board) return null;
  const names = new Map<string, Map<string | null, number>>();
  const people = new Map<string, number>();
  const vote = (id: string, name: string | null, count: number) => add(names.get(id) ?? names.set(id, new Map()).get(id)!, name, count);
  for (const row of mergedNames.results) vote(`${row.role}\0${row.key}\0`, row.name, row.people);
  for (const row of split.results) {
    vote(`${row.role}\0${row.key}\0${row.type}`, row.name, row.people);
    add(people, `${row.role}\0${row.key}\0${row.type}`, row.people);
  }
  for (const row of merged.results) people.set(`${row.role}\0${row.key}\0`, row.people);
  const rows = [...people].map(([id, count]): WeekRow => {
    const [role, key, type] = id.split('\0') as [PulseRole, string, string];
    return { role, key, type, name: mostCounted(names.get(id)!), people: count };
  });
  return {
    people: seen!,
    roles: new Map(roles.results.filter((row) => row.people >= PULSE_FLOORS.row).map((row) => [row.role, row.people])),
    models: rows.filter((row) => row.people >= PULSE_FLOORS.row),
    below: sortCounted(
      rows.filter((row) => row.key && row.people < PULSE_FLOORS.row),
      (row) => [row.people, row.name, row.type],
    ).map(({ role, key, type, name }) => ({ role, key, type, name })),
  };
}

// null for a week that never passed PULSE_FLOORS.board, whose lists were never shown.
async function keptWeek(db: Db, week: number): Promise<Period | null> {
  const people = await db.prepare('SELECT people FROM pulse_week WHERE week = ?').bind(week).first<number>('people');
  if (people === null) return null;
  const [roles, models, below] = await Promise.all([
    db.prepare('SELECT role, people FROM pulse_week_roles WHERE week = ?').bind(week).all<{ role: PulseRole; people: number }>(),
    db.prepare('SELECT role, key, type, name, people FROM pulse_week_models WHERE week = ?').bind(week).all<WeekRow>(),
    db.prepare('SELECT role, key, type, name FROM pulse_week_below WHERE week = ? ORDER BY place').bind(week).all<WeekName>(),
  ]);
  return { people, roles: new Map(roles.results.map((row) => [row.role, row.people])), models: models.results, below: below.results };
}

// Every day before now's closes the 7 days ending it, in one transaction: their rank places kept for the marks 7 days
// later, on a Sunday the week's totals written as it was shown, and the lists of the day no later window reaches deleted.
// One close at a time per database: a second that read pulse_closed before the first's batch would count a window
// whose oldest day the first had just deleted, and keep a ranked model of a closed week under the floor too.
const closing = new WeakMap<Db, Promise<void>>();
function closeDays(db: Db, now: number): Promise<void> {
  const closed = (closing.get(db) ?? Promise.resolve()).catch(() => {}).then(() => closePastDays(db, now));
  closing.set(db, closed);
  return closed;
}

async function closePastDays(db: Db, now: number) {
  const today = dayOf(now);
  const [closed, oldest] = await Promise.all([
    db.prepare('SELECT pulse_closed FROM service').first<number>('pulse_closed'),
    db.prepare('SELECT MIN(day) AS day FROM (SELECT day FROM pulse_people_seen UNION ALL SELECT day FROM pulse_used UNION ALL SELECT day FROM pulse_guest_used)').first<number | null>('day'),
  ]);
  // Days before the oldest list close nothing.
  for (let day = Math.max(closed!, oldest ?? today); day < today; day += DAY_MS) {
    const counted = await countDays(db, day);
    const week = weekOf(day);
    const sunday = weekOf(day + DAY_MS) !== week;
    await db.batch([
      ...(counted
        ? [
            db.prepare('INSERT INTO pulse_day_places (day, places) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(day, JSON.stringify(byRole((role) => places(rankPeriod(counted)[role])))),
            ...(sunday
              ? [
                  db.prepare('INSERT INTO pulse_week (week, people) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(week, counted.people),
                  ...[...counted.roles].map(([role, people]) => db.prepare('INSERT INTO pulse_week_roles (week, role, people) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(week, role, people)),
                  ...counted.models.map((row) =>
                    db.prepare('INSERT INTO pulse_week_models (week, role, key, type, name, people) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(week, row.role, row.key, row.type, row.name, row.people),
                  ),
                  ...counted.below.map((row, place) =>
                    db.prepare('INSERT INTO pulse_week_below (week, role, key, type, name, place) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(week, row.role, row.key, row.type, row.name, place),
                  ),
                ]
              : []),
          ]
        : []),
      ...['pulse_seen', 'pulse_used', 'pulse_guest_seen', 'pulse_guest_used'].map((table) => db.prepare(`DELETE FROM ${table} WHERE day < ?`).bind(firstDay(day + DAY_MS))),
      // The board on a later day reads the places of the day 7 days before it.
      db.prepare('DELETE FROM pulse_day_places WHERE day < ?').bind(firstDay(day + DAY_MS) - DAY_MS),
      db.prepare('UPDATE service SET pulse_closed = ?').bind(day + DAY_MS),
    ]);
  }
}

// null for a day whose 7 days never passed PULSE_FLOORS.board, whose ranking was never shown.
async function dayPlaces(db: Db, day: number): Promise<Record<PulseRole, PulseOrder> | null> {
  const kept = await db.prepare('SELECT places FROM pulse_day_places WHERE day = ?').bind(day).first<string>('places');
  return kept === null ? null : (JSON.parse(kept) as Record<PulseRole, PulseOrder>);
}

const rounded = (count: number) => Math.round(count / PULSE_FLOORS.round) * PULSE_FLOORS.round;
const typed = (type: string) => (type ? { type } : {});
const byRole = <T>(made: (role: PulseRole) => T) => Object.fromEntries(PULSE_ROLES.map((role) => [role, made(role)])) as Record<PulseRole, T>;
const ranked = (rows: { count: number; row: PulseRow }[]): PulseRanking => {
  const sorted = sortCounted(rows, ({ count, row }) => [count, row.model, row.type ?? '']).map(({ row }) => row);
  return { merged: sorted.filter((row) => row.type === undefined), split: sorted.filter((row) => row.type !== undefined) };
};
// rows: in order already.
const listed = (rows: PulseBelow[]): Pick<PulseRanking, 'below'> => {
  const view = (split: boolean) => {
    const own = rows.filter((row) => (row.type !== undefined) === split);
    return own.length < PULSE_FLOORS.below ? [] : own;
  };
  const below = { merged: view(false), split: view(true) };
  return below.merged.length || below.split.length ? { below } : {};
};
const place = ({ key, type }: PulseRow): PulsePlace => (type === undefined ? { key } : { key, type });
const places = ({ merged, split }: PulseRanking): PulseOrder => ({ merged: merged.map(place), split: split.map(place) });

const rankPeriod = (period: Period): PulseRankings =>
  byRole((role) => ({
    ...ranked(period.models.filter((row) => row.role === role).map(({ key, type, name, people }) => ({ count: people, row: { key, model: name, ...typed(type), share: people / period.roles.get(role)!, people } }))),
    ...listed(period.below.filter((row) => row.role === role).map(({ key, type, name }) => ({ key, model: name, ...typed(type) }))),
  }));

type Tally = { replies: number; people: Set<string>; names: Map<string | null, number> };

// The 24 whole hours before now's hour: each hour's calls, and 대화 ranked by its replies. A row needs 5 people in those
// hours and shows the people of its row in `days`, the 7 days ending today.
async function chatDay(db: Db, now: number, days: Period): Promise<{ hours: { at: number; calls: Record<PulseRole, number> }[]; ranking: PulseRanking }> {
  const until = hourOf(now);
  const since = until - DAY_MS;
  const [calls, replies, excluded] = await Promise.all([
    db.prepare('SELECT hour, role, calls FROM pulse_hours WHERE hour >= ? AND hour < ?').bind(since, until).all<{ hour: number; role: PulseRole; calls: number }>(),
    db.prepare('SELECT key, type, account, name, replies FROM pulse_rank_replies WHERE hour >= ? AND hour < ?').bind(since, until).all<{ key: string; type: string; account: string; name: string | null; replies: number }>(),
    db.prepare('SELECT COALESCE(SUM(replies), 0) AS replies FROM pulse_guest_replies WHERE hour >= ? AND hour < ? AND (SELECT pulse_guests FROM service) = 0').bind(since, until).first<number>('replies'),
  ]);
  const callsAt = new Map(calls.results.map((row) => [`${row.hour}\0${row.role}`, row.calls]));
  const hours = Array.from({ length: 24 }, (_, index) => {
    const at = since + index * HOUR_MS;
    return { at, calls: byRole((role) => callsAt.get(`${at}\0${role}`) ?? 0) };
  });
  const chatCalls = hours.reduce((sum, hour) => sum + hour.calls.chat, 0) - excluded!;
  const tallies = new Map<string, Tally>();
  for (const row of replies.results) {
    for (const id of [`${row.key}\0`, `${row.key}\0${row.type}`]) {
      const tally = tallies.get(id) ?? tallies.set(id, { replies: 0, people: new Set(), names: new Map() }).get(id)!;
      tally.replies += row.replies;
      tally.people.add(row.account);
      add(tally.names, row.name, row.replies);
    }
  }
  const peopleOf = new Map(days.models.filter((row) => row.role === 'chat').map((row) => [`${row.key}\0${row.type}`, row.people]));
  const shown: { count: number; row: PulseRow }[] = [];
  const under: { count: number; row: PulseBelow }[] = [];
  for (const [id, tally] of tallies) {
    const [key, type] = id.split('\0') as [string, string];
    const model = mostCounted(tally.names);
    // Each reply also wrote its person into pulse_used of a day within `days`, so 5 people here are 5 there.
    if (tally.people.size >= PULSE_FLOORS.row) shown.push({ count: tally.replies, row: { key, model, ...typed(type), share: tally.replies / chatCalls, people: peopleOf.get(id)!, replies: rounded(tally.replies) } });
    else if (key) under.push({ count: tally.replies, row: { key, model, ...typed(type) } });
  }
  const rest = (split: boolean): PulseRest => {
    const count = chatCalls - shown.reduce((sum, each) => ((each.row.type !== undefined) === split ? sum + each.count : sum), 0);
    return { share: chatCalls ? count / chatCalls : 0, replies: rounded(count) };
  };
  const below = sortCounted(under, ({ count, row }) => [count, row.model, row.type ?? '']).map(({ row }) => row);
  return { hours, ranking: { ...ranked(shown), rest: { merged: rest(false), split: rest(true) }, ...listed(below) } };
}

async function board(db: Db, now: number): Promise<PulseBoard | null> {
  await closeDays(db, now);
  const today = dayOf(now);
  const days = await countDays(db, today);
  if (!days) return null;
  const [weekAgo, weeks, day, dayBefore] = await Promise.all([
    dayPlaces(db, today - WEEK_MS),
    db.prepare('SELECT week FROM pulse_week ORDER BY week DESC').all<{ week: number }>(),
    chatDay(db, now, days),
    chatDay(db, now - DAY_MS, days),
  ]);
  return {
    people: days.people,
    replies: rounded(day.hours.reduce((sum, hour) => sum + hour.calls.chat, 0)),
    hours: day.hours.map(({ at, calls }) => ({ at, calls: byRole((role) => rounded(calls[role])) })),
    // The board's 대화 is the day's replies; the days' people rank it only once a week is past.
    ranking: { ...rankPeriod(days), chat: day.ranking },
    before: { ...byRole((role) => weekAgo && weekAgo[role]), chat: places(dayBefore.ranking) },
    weeks: weeks.results.map((row) => row.week),
  };
}

async function pastWeek(db: Db, from: number): Promise<PulseWeek | null> {
  const [week, prior] = await Promise.all([keptWeek(db, from), keptWeek(db, from - WEEK_MS)]);
  const priorRanking = prior && rankPeriod(prior);
  return week && { from, people: week.people, ranking: rankPeriod(week), before: byRole((role) => priorRanking && places(priorRanking[role])) };
}

// Hourly: past days closed, and hours gone by hour boundary, so the board's 대화 before reads
// [hourOf(now) - 2 days, hourOf(now) - 1 day) whole.
export async function forgetPulse(db: Db, now = Date.now()) {
  await closeDays(db, now);
  await db.batch(['pulse_hours', 'pulse_replies', 'pulse_guest_replies'].map((table) => db.prepare(`DELETE FROM ${table} WHERE hour < ?`).bind(hourOf(now) - HOURS_KEPT_MS)));
}

// A self-hosted installation's counts also go to hazelle.app's board (design §6.12, on by default since 2026-10-23), as
// the pings a guest sends: the person is a hash of the account or guest id, which that board can link to nothing.
export function forwarded(pulse: Pulse, board: URL, upstream: Upstream): Pulse {
  const remote = new URL('api/pulse/remote', board);
  return {
    ...pulse,
    call: async (account, label, guest) => {
      await pulse.call(account, label, guest);
      const hash = createHash('sha256').update(account).digest('hex');
      const client = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');
      const body = JSON.stringify({ client, label: pulseHeader(label) } satisfies GuestPulse);
      void upstream(remote, { method: 'POST', headers: new Headers({ 'content-type': 'application/json' }), body, redirect: 'manual', signal: AbortSignal.timeout(10_000) }).then(
        (answer) => answer.body?.cancel(),
        () => {},
      );
    },
  };
}

// A self-host's forwarded person is kept apart from this server's own guests by its prefix: migration 0022 leaves it out
// of the operator's daily 손님 응답, while the board counts it like a guest.
const REMOTE = 'remote:';
async function guestPing(c: Context<AppEnv>, prefix: '' | typeof REMOTE) {
  if (!c.env.limits.visitors.pulse.limit(c.req.header(VISITOR_HEADER) ?? 'direct').success) return fail(c, 429, 'too-many-visits');
  const body = await readObject(c);
  const client = body?.client;
  const label = typeof body?.label === 'string' ? readPulseHeader(body.label) : null;
  if (typeof client !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client) || label?.kind !== 'call') return fail(c, 400, 'bad-input');
  await c.env.pulse.seen(prefix + client, true);
  await c.env.pulse.call(prefix + client, label, true);
  return c.body(null, 204);
}

const WEEK_CACHE_SECONDS = 24 * 60 * 60;
export const pulse = new Hono<AppEnv>()
  .post('/guest', (c) => guestPing(c, ''))
  .post('/remote', (c) => guestPing(c, REMOTE))
  .get('/', async (c) => c.json(await c.env.pulse.answer(), 200, { 'cache-control': `public, max-age=${MEMO_MS / 1000}` }))
  .get('/weeks/:from', async (c) => {
    const found = await c.env.pulse.week(Number(c.req.param('from')));
    return found ? c.json(found, 200, { 'cache-control': `public, max-age=${WEEK_CACHE_SECONDS}` }) : fail(c, 404, 'not-found');
  });
