import { Hono, type Context } from 'hono';
import { MODELS_DEV_LISTS, MODELS_DEV_MODALITIES, type ListedModality, type ListedModel, type ModelsDevList, type PriceTable, type PriceTier, type Rates } from '../connectors/models-dev';
import type { Db } from './db/service-db';
import { fail, isRecord, type AppEnv } from './http';
import type { Upstream } from './relay';
import { VISITOR_HEADER } from '../contracts/http';

const SOURCE = 'https://models.dev/api.json';
const LISTS = new Set(Object.values(MODELS_DEV_LISTS).map((entry) => entry!.list));
// The hourly cron asks every time; the list is fetched again once it is this old, so about once a day.
const STALE_MS = 23 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
// A fetch is background work the shutdown drain waits for, so it is bounded.
const FETCH_MS = 60 * 1000;

// name: models.dev's display name, which 헤이젤 나우 shows (pulse.ts); null where it gives none.
type ListedRow = ListedModel & { list: string; model: string; name: string | null };

const rate = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

// Unknown prices or non-context tiering must stay unpriced: ignoring tiers would understate bills.
// context_over_200k duplicates the tier table.
function ratesOf(cost: unknown): Rates | null {
  if (!isRecord(cost)) return null;
  const input = rate(cost.input);
  const output = rate(cost.output);
  if (input === null || output === null || (cost.tiers !== undefined && !Array.isArray(cost.tiers))) return null;
  const tiers: PriceTier[] = [];
  for (const raw of (cost.tiers ?? []) as unknown[]) {
    if (!isRecord(raw) || !isRecord(raw.tier) || raw.tier.type !== 'context') return null;
    const above = rate(raw.tier.size);
    const tierInput = rate(raw.input);
    const tierOutput = rate(raw.output);
    if (above === null || tierInput === null || tierOutput === null) return null;
    tiers.push({ above, input: tierInput, output: tierOutput, cacheRead: rate(raw.cache_read), cacheWrite: rate(raw.cache_write) });
  }
  return { input, output, cacheRead: rate(cost.cache_read), cacheWrite: rate(cost.cache_write), tiers: tiers.sort((a, b) => a.above - b.above) };
}

const WORDS = new Map<unknown, ListedModality>(Object.entries(MODELS_DEV_MODALITIES));
const modalitiesOf = (value: unknown): ListedModality[] | null => (Array.isArray(value) ? value.flatMap((word) => WORDS.get(word) ?? []) : null);

// null when the payload is not models.dev's provider map at all.
function listedRows(payload: unknown): ListedRow[] | null {
  if (!isRecord(payload)) return null;
  const rows: ListedRow[] = [];
  for (const list of LISTS) {
    const provider = payload[list];
    if (!isRecord(provider) || !isRecord(provider.models)) continue;
    for (const [model, raw] of Object.entries(provider.models)) {
      if (!isRecord(raw)) continue;
      const modalities = isRecord(raw.modalities) ? raw.modalities : {};
      const row = { list, model, name: typeof raw.name === 'string' && raw.name ? raw.name : null, price: ratesOf(raw.cost), input: modalitiesOf(modalities.input), output: raw.type === 'embedding' ? ['embedding' as const] : modalitiesOf(modalities.output), tools: typeof raw.tool_call === 'boolean' ? raw.tool_call : null };
      if (row.price || row.input || row.output || row.tools !== null) rows.push(row);
    }
  }
  return rows;
}

// One fetch at a time, claimed through tried_at. A failed fetch keeps the list already stored.
export async function refreshModelsDev(db: Db, outbound: Upstream, now = Date.now()): Promise<void> {
  const claimed = await db
    .prepare('UPDATE models_dev_fetch SET tried_at = ?1 WHERE id = 1 AND (fetched_at IS NULL OR fetched_at < ?2) AND (tried_at IS NULL OR tried_at < ?3) RETURNING id')
    .bind(now, now - STALE_MS, now - RETRY_MS)
    .first();
  if (!claimed) return;
  let rows: ListedRow[] | null;
  try {
    const response = await outbound(new URL(SOURCE), { method: 'GET', headers: new Headers(), body: null, redirect: 'manual', signal: AbortSignal.timeout(FETCH_MS) });
    rows = response.ok ? listedRows(await response.json()) : null;
    if (!rows) console.error(`models.dev list unreadable (status ${response.status})`);
  } catch (error) {
    console.error('models.dev list fetch failed', error);
    return;
  }
  if (!rows?.length) return;
  await db.batch([
    db.prepare('DELETE FROM models_dev'),
    db
      .prepare(
        `INSERT INTO models_dev (list, model, name, price, input, output, tools)
         SELECT value->>'list', value->>'model', value->>'name', value->>'price', value->>'input', value->>'output', value->>'tools' FROM json_each(?)`,
      )
      .bind(JSON.stringify(rows)),
    db.prepare('UPDATE models_dev_fetch SET fetched_at = ? WHERE id = 1').bind(now),
  ]);
}

type Row = { model: string; price: string | null; input: string | null; output: string | null; tools: number | null };
type TableRow = { list: string; model: string; name: string | null; price: string | null };
const parsed = <T>(json: string | null): T | null => (json === null ? null : (JSON.parse(json) as T));

// Before the first fetch has landed it answers empty and starts one; the hourly cron would otherwise leave every cost
// 알 수 없음 for up to an hour after a deploy.
async function answer<T extends { fetchedAt: number | null }>(c: Context<AppEnv>, empty: T, read: (fetchedAt: number) => Promise<T>) {
  const db = c.env.db;
  const fetchedAt = await db.prepare('SELECT fetched_at FROM models_dev_fetch WHERE id = 1').first<number | null>('fetched_at');
  if (fetchedAt === null) {
    c.executionCtx.waitUntil(refreshModelsDev(db, c.env.outbound));
    return c.json(empty);
  }
  const etag = `"${fetchedAt}"`;
  const headers = { etag, 'cache-control': 'private, no-cache' };
  if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers);
  return c.json(await read(fetchedAt), 200, headers);
}

const visits = (c: Context<AppEnv>) => c.env.limits.visitors.reads.limit(c.req.header(VISITOR_HEADER) ?? 'direct').success;

export const modelsDev = new Hono<AppEnv>()
  .get('/', async (c) => {
    if (!visits(c)) return fail(c, 429, 'too-many-visits');
    const list = c.req.query('provider');
    if (!list || !LISTS.has(list)) return fail(c, 400, 'bad-input');
    return answer<ModelsDevList>(c, { fetchedAt: null, models: {} }, async (fetchedAt) => {
      const { results } = await c.env.db.prepare('SELECT model, price, input, output, tools FROM models_dev WHERE list = ?').bind(list).all<Row>();
      const models = Object.fromEntries(results.map((row) => [row.model, { price: parsed<Rates>(row.price), input: parsed<ListedModality[]>(row.input), output: parsed<ListedModality[]>(row.output), tools: row.tools === null ? null : row.tools === 1 }]));
      return { fetchedAt, models };
    });
  })
  .get('/table', async (c) => {
    if (!visits(c)) return fail(c, 429, 'too-many-visits');
    return answer<PriceTable>(c, { fetchedAt: null, models: [] }, async (fetchedAt) => {
      const { results } = await c.env.db.prepare('SELECT list, model, name, price FROM models_dev').all<TableRow>();
      return { fetchedAt, models: results.map((row) => ({ ...row, price: parsed<Rates>(row.price) })) };
    });
  });
