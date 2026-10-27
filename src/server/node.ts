import { mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { BlockList, isIP, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { serve } from '@hono/node-server';
import { Hono, type ExecutionContext } from 'hono';
import { alerts, slowLoop } from './alerts';
import { serviceReads } from './account-store';
import { forgetOldRecords } from './admin';
import { backups } from './backup/backups';
import { freePercent } from './backup/freshness';
import { listGenerations } from './backup/generation';
import { accountRegistry } from './db/account-db';
import { migrate } from './db/migrate';
import { openDatabase, serviceDb } from './db/service-db';
import { chooseBucket } from './files/choose';
import type { FrontendOptions } from './frontend-worker';
import { DAY_MS, fail, visitDay, type Services } from './http';
import { RELAY_DAILY, relayBudget, tokenBucket, uploadBudget, visitorLimits } from './limits';
import { localProviders, pinnedOutbound } from './outbound';
import { refreshModelsDev } from './models-dev';
import { forgetPulse, openPulse } from './pulse';
import { reconcile } from './reconcile';
import { streamRegistry } from './stream-registry';
import { streamStore } from './db/streams-db';
import app from './worker';
import { publishNews, RELEASE_NEWS } from './news';
import { VERSION_HEADER } from '../contracts/http';
import type { Release } from '../contracts/installation';
import { releases } from './releases';
import { openVisits, type FrontendMessage } from './visits';

// Configuration is the environment (docs/research/docker-port-plan.md §11).
const dataDir = process.env.HAZELLE_DATA ?? '/data';
// Treat blank compose variables as unset, not Number("") = 0. Reject nonintegral/out-of-range settings
// at startup; an invalid snapshot hour could otherwise silently disable backups.
function wholeFrom(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim() ?? '';
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`hazelle: ${name} must be a whole number from ${min} to ${max}: ${raw}`);
    process.exit(1);
  }
  return value;
}
// Addresses or CIDR ranges, comma-separated, whose X-Forwarded-For names the visitor (frontend-worker.ts). Blank trusts
// none. An entry that is neither refuses the start, as a malformed number does.
function proxiesFrom(name: string): BlockList {
  const trusted = new BlockList();
  for (const entry of (process.env[name] ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
    const [, address = '', prefix] = /^([^/]+)(?:\/(\d{1,3}))?$/.exec(entry) ?? [];
    const family = isIP(address);
    const bits = prefix === undefined ? null : Number(prefix);
    if (!family || (bits !== null && bits > (family === 4 ? 32 : 128))) {
      console.error(`hazelle: ${name} must list addresses or CIDR ranges: ${entry}`);
      process.exit(1);
    }
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (bits === null) trusted.addAddress(address, type);
    else trusted.addSubnet(address, bits, type);
  }
  return trusted;
}
const port = wholeFrom('PORT', 8080, 1, 65535);
// Someone's own installation, not hazelle.app: docker-compose.yml and launch.ts set it, and the hosted machine resets it.
// A development server sets nothing and runs as hazelle.app does, so a missing flag shows the hosted terms and limits.
const selfHost = wholeFrom('HAZELLE_SELF_HOST', 0, 0, 1) === 1;
// The non-Docker launcher (launch.ts) sets 127.0.0.1; blank listens on every interface.
const host = process.env.HAZELLE_HOST || undefined;
const trustedProxies = proxiesFrom('HAZELLE_TRUSTED_PROXIES');
const drainMs = wholeFrom('HAZELLE_DRAIN_SECONDS', 60, 0, 3600) * 1000;
// A self-host's computer may be on for part of the day only; from hour 0 its first start of each UTC day takes the day's.
const snapshotHour = wholeFrom('HAZELLE_SNAPSHOT_HOUR', selfHost ? 0 : 3, 0, 23);
// The Dockerfile sets it: inside the image a folder the admin names is the container's own, gone at the next update.
const container = wholeFrom('HAZELLE_CONTAINER', 0, 0, 1) === 1;
// Two directories up from both src/server/node.ts and dist/server/node.js; a bundle placed elsewhere names them.
const migrationsDir = process.env.HAZELLE_MIGRATIONS ?? join(import.meta.dirname, '..', '..', 'migrations');
const clientDir = process.env.HAZELLE_CLIENT ?? 'dist/client';
// The Dockerfile's HAZELLE_VERSION, the tag the image was built from, written into the bundle by build:server's define,
// so the app copied out of the image (launch.ts) carries it too; a build without one says none.
const version = process.env.HAZELLE_VERSION || null;
let files: Services['files'];
try {
  files = chooseBucket(process.env, dataDir);
} catch (error) {
  console.error(`hazelle: ${(error as Error).message}`);
  process.exit(1);
}
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const log = (event: string, detail: Record<string, unknown> = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), event, ...detail }));

mkdirSync(dataDir, { recursive: true });

// Account ordering is process-local: exclusively lock data/ with an open SQLite transaction.
// The kernel releases it on crash, unlike a stale lock file.
const lock = new DatabaseSync(join(dataDir, 'lock.sqlite'));
try {
  lock.exec('BEGIN EXCLUSIVE');
} catch {
  console.error(`hazelle: another process holds ${dataDir}`);
  process.exit(1);
}

const raw = openDatabase(join(dataDir, 'service.sqlite'));
const { applied } = migrate(raw, migrationsDir);
// A self-host's 소식 are hazelle.app's board, which its 게시판 link opens.
if (!selfHost) publishNews(raw, version, RELEASE_NEWS, Date.now());
const db = serviceDb(raw);
const visits = openVisits(raw);
let dayClose: ReturnType<typeof setTimeout>;
const scheduleDayClose = () => {
  dayClose = setTimeout(() => {
    visits.close();
    scheduleDayClose();
  }, visitDay(Date.now()) + DAY_MS - Date.now());
  dayClose.unref();
};
scheduleDayClose();
const limits = {
  // hazelle.app's budget against using its relay as an open proxy; a self-host's relay is its owner's, unlimited unless set.
  relay: relayBudget(
    wholeFrom('HAZELLE_RELAY_DAILY_BYTES', selfHost ? Infinity : RELAY_DAILY.bytes, 1, Number.MAX_SAFE_INTEGER),
    wholeFrom('HAZELLE_RELAY_DAILY_HOSTS', selfHost ? Infinity : RELAY_DAILY.hosts, 1, 100_000),
  ),
  calls: tokenBucket(240), botCalls: tokenBucket(20), visitors: visitorLimits(), uploads: uploadBudget(),
};
const operatorAlerts = alerts(process.env.HAZELLE_ALERT_WEBHOOK || null);
const local = localProviders(process.env.HAZELLE_LOCAL_PROVIDERS ?? '');
const outbound = pinnedOutbound(local);
const release = releases(outbound, version);
const services: Services = {
  db,
  files,
  stores: accountRegistry(dataDir, db, serviceReads(db), Date.now, files),
  streams: streamRegistry(streamStore(join(dataDir, 'streams.sqlite')), outbound, limits.relay),
  outbound,
  localProviders: local,
  limits,
  backups: backups(dataDir, snapshotHour, operatorAlerts, freePercent, !selfHost ? 'remote' : !container && files.kind === 'disk' ? 'folder' : 'optional'),
  pulse: openPulse(db),
};

// Work a request leaves running after its answer; the shutdown waits for it.
const background = new Set<Promise<unknown>>();
const ctx: ExecutionContext = {
  waitUntil: (work) => {
    background.add(work);
    work.catch((error: unknown) => log('background failed', { error: String(error) })).finally(() => background.delete(work));
  },
  passThroughOnException: () => {},
  props: {},
};

let draining = false;
const root = new Hono();
if (version) root.use('/api/*', async (c, next) => {
  c.header(VERSION_HEADER, version);
  await next();
});
root.get('/api/health', async (c) => {
  // Seen only by a request already on an open connection: server.close refuses new connections at once.
  if (draining) return c.json({ ok: false, draining: true }, 503);
  const { backupAgeHours, diskFreePercent } = await services.backups.freshness(services, Date.now());
  return c.json({ ok: true, liveCalls: services.streams.live(), backupAgeHours, diskFreePercent });
});
root.get('/api/release', (c) => c.json({ newer: release.newer() } satisfies Release));
root.route('/', app);
// An unknown API path is a real 404, never the page.
root.all('/api/*', (c) => fail(c, 404, 'not-found'));

const server = serve({ fetch: (request) => root.fetch(request, services, ctx), hostname: '127.0.0.1', port: 0 }) as Server;
await once(server, 'listening');
// The public listener owns no databases, so even a synchronous SQL operation cannot hold its asset responses.
const frontend = new Worker(new URL(import.meta.url.endsWith('.ts') ? './frontend-worker.ts' : './frontend-worker.js', import.meta.url), {
  workerData: { port, host, apiPort: (server.address() as AddressInfo).port, clientDir, trustedProxies, selfHost } satisfies FrontendOptions,
});
frontend.on('error', (error) => { log('frontend failed', { error: String(error) }); process.exit(1); });
frontend.on('exit', (code) => { if (!draining) { log('frontend stopped', { code }); process.exit(1); } });
frontend.on('message', (message: FrontendMessage) => {
  if (typeof message !== 'string') visits.page(message);
});
const frontendClosed = new Promise<void>((resolve) => frontend.on('message', (message: FrontendMessage) => { if (message === 'closed') resolve(); }));
await once(frontend, 'message');
log('listening', { port, dataDir, files: files.kind, migrationsApplied: applied });

const hourly = () => {
  ctx.waitUntil(refreshModelsDev(db, outbound));
  ctx.waitUntil(forgetOldRecords(db));
  ctx.waitUntil(forgetPulse(db));
  ctx.waitUntil(reconcile(dataDir, db, files).then(({ removed }) => removed.length && log('reconciled', { removed })));
  if (selfHost) ctx.waitUntil(release.refresh());
};
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
const slow = slowLoop();
const timers = [
  setInterval(() => {
    if (eventLoop.max > 250_000_000) {
      log('event loop delayed', { maxMs: Math.round(eventLoop.max / 1e6), p99Ms: Math.round(eventLoop.percentile(99) / 1e6), background: background.size });
      const now = Date.now();
      if (slow(now)) ctx.waitUntil(operatorAlerts.send(services, 'server-slow', now));
    }
    eventLoop.reset();
  }, 10_000),
  setInterval(hourly, HOUR_MS),
  setInterval(() => {
    services.stores.evictIdle();
    limits.calls.evict();
    limits.botCalls.evict();
    for (const limit of Object.values(limits.visitors)) limit.evict();
  }, 10 * MINUTE_MS),
  setTimeout(hourly, MINUTE_MS),
  setInterval(() => ctx.waitUntil(services.streams.expire(Date.now())), MINUTE_MS),
  setInterval(() => ctx.waitUntil(services.backups.tick(services, Date.now())), HOUR_MS),
  setTimeout(() => ctx.waitUntil(services.backups.tick(services, Date.now())), MINUTE_MS),
];
for (const timer of timers) timer.unref();

// Drain requests/background work/detached replies until deadline before closing DBs.
// After timeout, restarted readers get persisted pages then a lost stream, never a fabricated clean end.
async function shutdown(signal: string) {
  if (draining) return;
  draining = true;
  const frontendDraining = new Promise<void>((resolve) => {
    const drainingMessage = (message: FrontendMessage) => {
      if (message !== 'draining') return;
      frontend.off('message', drainingMessage);
      resolve();
    };
    frontend.on('message', drainingMessage);
  });
  frontend.postMessage('drain');
  await frontendDraining;
  log('draining', { signal, drainMs });
  for (const timer of timers) clearTimeout(timer);
  eventLoop.disable();
  const deadline = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), drainMs).unref());
  const drained = (async () => {
    // The public requests must finish proxying before the API listener stops accepting their connections.
    await frontendClosed;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // A request answered during the wait may have registered more work, and finished work may have chained some.
    while (background.size) await Promise.allSettled([...background]);
    await services.streams.settled();
  })();
  const outcome = await Promise.race([drained.then(() => 'drained' as const), deadline]);
  server.closeAllConnections();
  await frontend.terminate();
  try {
    services.stores.close();
    services.streams.close();
    clearTimeout(dayClose);
    raw.close();
    lock.close();
  } catch (error) {
    log('close failed', { error: String(error) });
  }
  log('stopped', { outcome, left: background.size });
  process.exit(0);
}
// Keep deployment signal handler and its two acknowledgment log lines aligned with scripts/deploy.sh.
// Without a handler Node exits immediately. Refuse new capture work once shutdown draining begins.
process.on('SIGUSR2', () => {
  if (draining) return log('backup refused', { reason: 'draining' });
  log('backup requested');
  ctx.waitUntil(
    services.backups.fresh(services).then(async ({ snapshots, generation }) => {
      // Jobs run one at a time, so the newest generation after an ok run is this run's.
      const newest = generation.outcome === 'ok' ? (await listGenerations(dataDir)).sort((a, b) => a.capturedAt - b.capturedAt).at(-1) : undefined;
      log('backup finished', { snapshots: snapshots.outcome, generation: generation.outcome, id: newest?.id ?? null });
    }),
  );
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
// A closed Windows console window or Termux session; Windows ends the process about 10 s later whatever the drain.
process.on('SIGHUP', () => void shutdown('SIGHUP'));
