// Local production-image harness (4 vCPU, 8 GB).
//   docker build -t hazelle-load:local .
//   NODE_OPTIONS=--max-old-space-size=4096 ./node_modules/.bin/tsx scripts/load/run.ts --accounts 20 --out results.json
// Seed fresh API-created accounts (first operator lifts caps), sealed-looking text and pictures.
// Phases: daily restarts at snapshot hour 0; fresh writes then SIGUSR2; streams/uploads run requested concurrency.
// Probe health, open-loop read/write latency, signup refusals, Docker/RSS and server stalls throughout.
// --server-env is repeatable; --keep retains container/data/provider, otherwise cleanup removes them.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { diskBytes, docker, logs, query, sampler, startContainer, stopContainer, type Sample } from './container';
import { objectBodies, pictures, planAccounts, type Range, type Shape } from './content';
import { Hazelle, type Account } from './hazelle';
import { clockSteps, peaks, pool, probe, summarize, within, type Timing } from './measure';

const { values: args } = parseArgs({
  options: {
    accounts: { type: 'string', default: '20' },
    seed: { type: 'string', default: 'hazelle-load' },
    'text-mb': { type: 'string', default: '20-60' },
    'big-share': { type: 'string', default: '0.1' },
    'big-text-mb': { type: 'string', default: '150-300' },
    'picture-mb': { type: 'string', default: '50-500' },
    'picture-kb': { type: 'string', default: '30-500' },
    shared: { type: 'string', default: '0.25' },
    'shared-pool': { type: 'string', default: '3000' },
    'fill-concurrency': { type: 'string', default: '6' },
    phases: { type: 'string', default: 'daily,fresh,streams,uploads' },
    streams: { type: 'string', default: '20,50,100' },
    'stream-seconds': { type: 'string', default: '30' },
    uploaders: { type: 'string', default: '15' },
    'upload-mb': { type: 'string', default: '40' },
    image: { type: 'string', default: 'hazelle-load:local' },
    cpus: { type: 'string', default: '4' },
    memory: { type: 'string', default: '8g' },
    port: { type: 'string', default: '18080' },
    'provider-port': { type: 'string', default: '14419' },
    work: { type: 'string', default: tmpdir() },
    out: { type: 'string', default: 'load-results.json' },
    keep: { type: 'boolean', default: false },
    'server-env': { type: 'string', multiple: true, default: [] },
  },
});

const range = (text: string): Range => text.split('-').map(Number) as Range;
const count = Number(args.accounts);
const phases = new Set(args.phases.split(','));
const shape: Shape = {
  seed: args.seed,
  textMb: range(args['text-mb']),
  bigShare: Number(args['big-share']),
  bigTextMb: range(args['big-text-mb']),
  pictureMb: range(args['picture-mb']),
  pictureKb: range(args['picture-kb']),
  shared: Number(args.shared),
  sharedPool: Number(args['shared-pool']),
};
const name = `hazelle-load-${count}`;
const providerPort = Number(args['provider-port']);
const api = new Hazelle(`http://127.0.0.1:${args.port}`);
const results: Record<string, unknown> = {
  args,
  machine: { cpus: `${cpus().length} × ${cpus()[0]?.model}`, memoryGb: Math.round(totalmem() / 2 ** 30), kernel: release(), docker: (await docker('version', '--format', '{{.Server.Version}} {{.Server.Os}}')).trim() },
};
const samples: Sample[] = [];
const clock = clockSteps();
const logLines: string[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (text: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${text}`);
const MB = 2 ** 20;

if (new Date().getUTCHours() === 23) throw new Error('At 23:00 UTC the filling container would run its daily job; start after midnight UTC.');

const dataDir = mkdtempSync(join(args.work, 'hazelle-load-'));
const provider = spawn(process.execPath, [join(import.meta.dirname, 'fake-provider.ts'), String(providerPort)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise<void>((resolve, reject) => {
  provider.stdout.once('data', () => {
    provider.stdout.resume();
    resolve();
  });
  provider.once('exit', (code) => reject(new Error(`the fake provider exited (${code})`)));
});

let watcher: ReturnType<typeof sampler> | null = null;
const boot = async (snapshotHour: number) => {
  await startContainer({ image: args.image, name, dataDir, port: Number(args.port), provider: `host.docker.internal:${providerPort}`, snapshotHour, cpus: Number(args.cpus), memory: args.memory, env: args['server-env'] });
  for (const deadline = Date.now() + 120_000; !(await api.health()); await sleep(250)) if (Date.now() > deadline) throw new Error('the server did not become healthy');
  watcher = sampler(name);
};
const halt = async () => {
  if (watcher) samples.push(...(await watcher.stop()));
  watcher = null;
  logLines.push(...(await logs(name).catch(() => '')).split('\n'));
  await stopContainer(name);
};

try {
  await boot(23);
  say(`container up, data in ${dataDir}`);
  const plans = planAccounts(shape, count);
  const operator = (await api.signup('load0000'))!;
  await api.setService(operator, { signupCap: 1_000_000, accountBytesCap: null, accountFileBytesCap: null });
  const accounts: Account[] = [operator];
  for (let index = 1; index < count; index++) accounts.push((await api.signup(`load${String(index).padStart(4, '0')}`))!);
  const big = plans.reduce((most, plan, index) => (plan.textBytes > plans[most]!.textBytes ? index : most), 0);
  const small = accounts.filter((_, index) => plans[index]!.textBytes < shape.bigTextMb[0] * MB);
  const pick = (list: Account[]) => list[Math.floor(Math.random() * list.length)]!;

  say(`filling ${count} accounts: ${(plans.reduce((sum, plan) => sum + plan.textBytes, 0) / MB).toFixed(0)} MB text, ${(plans.reduce((sum, plan) => sum + plan.pictureBytes, 0) / MB).toFixed(0)} MB pictures`);
  const fillStarted = Date.now();
  let pictureCount = 0;
  let busy = 0;
  await pool(accounts, Number(args['fill-concurrency']), async (account, index) => {
    await api.writeText(account, objectBodies(`${shape.seed}:${index}:text`, plans[index]!.textBytes));
    for (const picture of pictures(shape, `${shape.seed}:${index}`, plans[index]!.pictureBytes)) {
      const uploaded = await api.upload(account, picture);
      if (uploaded.status !== 204) throw new Error(`upload for ${account.username} answered ${uploaded.status}`);
      pictureCount++;
      busy += uploaded.busy;
    }
  });
  const fillMs = Date.now() - fillStarted;
  const files = await query<{ rows: number; distinct: number; bytes: number }>(name, 'SELECT COUNT(*) AS rows, COUNT(DISTINCT id) AS "distinct", SUM(size) AS bytes FROM account_files');
  results.fill = {
    accounts: count,
    plans: plans.map(({ textBytes, pictureBytes }) => ({ textMb: +(textBytes / MB).toFixed(1), pictureMb: +(pictureBytes / MB).toFixed(1) })),
    ms: fillMs,
    pictures: pictureCount,
    pictureRows: files[0],
    uploadBusyWaits: busy,
    diskBytes: await diskBytes(dataDir),
  };
  say(`filled in ${(fillMs / 1000).toFixed(0)} s, ${pictureCount} pictures, ${(((results.fill as { diskBytes: number }).diskBytes) / 2 ** 30).toFixed(1)} GiB on disk`);

  // Latency of other accounts' work and of signups while a backup job runs, classified afterwards by the job's
  // recorded times.
  const watchBackup = async (trigger: () => Promise<void>, label: string) => {
    const last = (await query<{ last: number }>(name, 'SELECT COALESCE(MAX(id), 0) AS last FROM backup_runs'))[0]!.last;
    const disk = await diskBytes(dataDir);
    const begun = Date.now();
    const probes = {
      health: probe(200, () => api.request('health', { timeoutMs: 600_000 })),
      smallWrite: probe(200, () => api.batch(pick(small), ['x'.repeat(2000)])),
      smallRead: probe(200, () => api.poll(pick(small))),
      bigWrite: probe(500, () => api.batch(accounts[big]!, ['x'.repeat(2000)])),
      // A taken name: the attempt waits on the backup hold like any signup, then is refused without adding an account.
      // Each leaves an account file with no row, which the hourly reconciliation removes.
      signup: probe(2000, async () => {
        const response = await api.signupRequest(randomUUID(), operator.username, 600_000);
        await response.body?.cancel();
        return response.status === 409 ? 200 : response.status;
      }),
    };
    await sleep(10_000);
    const triggered = Date.now();
    await trigger();
    type Run = { id: number; kind: string; started_at: number; ended_at: number | null; outcome: string; gate_ms: number | null; detail: string | null; error: string | null };
    const finished = async (): Promise<Run[]> => {
      for (const deadline = Date.now() + 90 * 60_000; Date.now() < deadline; await sleep(1000)) {
        const runs = await query<Run>(name, `SELECT id, kind, started_at, ended_at, outcome, gate_ms, detail, error FROM backup_runs WHERE id > ${last} ORDER BY id`);
        if (runs.some((run) => run.kind === 'generation' && run.outcome !== 'running')) return runs;
      }
      throw new Error(`${label}: no generation within 90 minutes`);
    };
    const runs = await finished();
    const ended = Date.now();
    await sleep(5_000);
    const timings = Object.fromEntries(await Promise.all(Object.entries(probes).map(async ([key, each]) => [key, await each.stop()] as const))) as Record<keyof typeof probes, Timing[]>;
    const daily = runs.find((run) => run.kind === 'daily')!;
    const generation = runs.find((run) => run.kind === 'generation')!;
    const generationStart = generation.started_at;
    const generationEnd = generation.ended_at!;
    const windows = {
      before: [begun, daily.started_at],
      baselines: [daily.started_at, generationStart],
      generation: [generationStart, generationEnd],
      gate: [generationStart, generationStart + (generation.gate_ms ?? 0)],
    } as const;
    const snapshotTotals = await query(name, `SELECT COUNT(*) AS taken, SUM(bytes) AS bytes, SUM(expanded) AS expanded, MAX(expanded) AS largest FROM snapshots WHERE taken_at >= ${daily.started_at}`);
    return {
      triggerToStartMs: daily.started_at - triggered,
      baselineMs: daily.ended_at! - daily.started_at,
      generationMs: generationEnd - generationStart,
      totalMs: generationEnd - daily.started_at,
      observedEndLagMs: ended - generationEnd,
      gateMs: generation.gate_ms,
      runs: runs.map((run) => ({ ...run, detail: run.detail ? JSON.parse(run.detail) : null })),
      snapshots: snapshotTotals[0],
      diskAddedBytes: (await diskBytes(dataDir)) - disk,
      latency: Object.fromEntries(Object.entries(windows).map(([window, [from, to]]) => [window, Object.fromEntries(Object.entries(timings).map(([key, list]) => [key, summarize(within(list, from, to))]))])),
      failures: Object.fromEntries(Object.entries(timings).map(([key, list]) => [key, list.filter(({ ok }) => !ok)])),
      slowest: Object.fromEntries(Object.entries(timings).map(([key, list]) => [key, [...list].sort((a, b) => b.ms - a.ms).slice(0, 3)])),
      peaks: { before: peaks(watcher!.samples, begun, daily.started_at), during: peaks(watcher!.samples, daily.started_at, generationEnd) },
      windows,
    };
  };

  if (phases.has('daily')) {
    await halt();
    await boot(0);
    say('daily: restarted with HAZELLE_SNAPSHOT_HOUR=0; the first tick comes a minute after start');
    // The tick fires a minute after the process starts; the probes start once the server answers.
    results.daily = await watchBackup(async () => {}, 'daily');
    say(`daily done: ${JSON.stringify({ total: (results.daily as { totalMs: number }).totalMs, gate: (results.daily as { gateMs: number }).gateMs })}`);
  }

  if (phases.has('fresh')) {
    await pool(accounts, 8, async (account) => {
      const response = await api.batch(account, ['touched'.repeat(100)]);
      await response.body?.cancel();
    });
    results.fresh = await watchBackup(async () => void (await docker('kill', '--signal', 'SIGUSR2', name)), 'fresh');
    say(`fresh done: ${JSON.stringify({ total: (results.fresh as { totalMs: number }).totalMs, gate: (results.fresh as { gateMs: number }).gateMs })}`);
  }

  if (phases.has('streams') && args.streams !== 'none') {
    const runs = [];
    for (const streams of args.streams.split(',').map(Number)) {
      const health = probe(100, () => api.request('health', { timeoutMs: 60_000 }));
      await sleep(3_000);
      const started = Date.now();
      const request = {
        url: `http://host.docker.internal:${providerPort}/v1/chat/completions`,
        body: JSON.stringify({ model: 'fake', stream: true, messages: [{ role: 'user', content: 'x'.repeat(20_000) }], load: { seconds: Number(args['stream-seconds']), intervalMs: 50, bytes: 200 } }),
      };
      const outcomes = await Promise.all(Array.from({ length: streams }, (_, index) => api.stream(accounts[index % count]!, request, (Number(args['stream-seconds']) + 120) * 1000)));
      const ended = Date.now();
      await sleep(3_000);
      const healthTimings = await health.stop();
      const ends: Record<string, number> = {};
      for (const outcome of outcomes) ends[`${outcome.status}/${outcome.upstream}/${outcome.end}`] = (ends[`${outcome.status}/${outcome.upstream}/${outcome.end}`] ?? 0) + 1;
      const firstData = outcomes.flatMap(({ firstDataMs }) => (firstDataMs === null ? [] : [{ at: 0, ms: firstDataMs, ok: true, status: 200 }]));
      runs.push({
        streams,
        wallMs: ended - started,
        ends,
        firstData: summarize(firstData),
        duration: summarize(outcomes.map(({ ms }) => ({ at: 0, ms, ok: true, status: 200 }))),
        bytes: outcomes.reduce((sum, { bytes }) => sum + bytes, 0),
        frames: outcomes.reduce((sum, { frames }) => sum + frames, 0),
        healthBefore: summarize(within(healthTimings, 0, started)),
        healthDuring: summarize(within(healthTimings, started, ended)),
        peaks: peaks(watcher!.samples, started, ended),
      });
      say(`streams ${streams}: ${JSON.stringify(runs.at(-1)!.ends)}`);
      await sleep(5_000);
    }
    results.streams = runs;
  }

  if (phases.has('uploads')) {
    const uploaders = accounts.slice(0, Number(args.uploaders));
    const health = probe(100, () => api.request('health', { timeoutMs: 60_000 }));
    await sleep(3_000);
    const timings: Timing[] = [];
    let bytes = 0;
    let waits = 0;
    const started = Date.now();
    await Promise.all(
      uploaders.map(async (account, index) => {
        for (const picture of pictures({ ...shape, shared: 0 }, `${shape.seed}:upload:${index}`, Number(args['upload-mb']) * MB)) {
          const at = Date.now();
          const begun = performance.now();
          const uploaded = await api.upload(account, picture);
          timings.push({ at, ms: performance.now() - begun, ok: uploaded.status === 204, status: uploaded.status });
          bytes += picture.length;
          waits += uploaded.busy;
        }
      }),
    );
    const ended = Date.now();
    await sleep(3_000);
    const healthTimings = await health.stop();
    results.uploads = {
      uploaders: uploaders.length,
      pictures: timings.length,
      mb: +(bytes / MB).toFixed(1),
      wallMs: ended - started,
      mbPerSecond: +(bytes / MB / ((ended - started) / 1000)).toFixed(1),
      busyWaits: waits,
      perPicture: summarize(timings),
      healthBefore: summarize(within(healthTimings, 0, started)),
      healthDuring: summarize(within(healthTimings, started, ended)),
      peaks: peaks(watcher!.samples, started, ended),
    };
    say(`uploads: ${JSON.stringify(results.uploads)}`);
  }
} finally {
  await halt().catch(() => {});
  provider.kill();
  const stamp = (line: string) => Date.parse(/"at":"([^"]+)"/.exec(line)?.[1] ?? '');
  results.serverLog = {
    eventLoopDelayed: logLines.filter((line) => line.includes('event loop delayed')).map((line) => ({ at: stamp(line), ...(JSON.parse(line) as object) })),
    slowRequests: logLines.filter((line) => line.includes('slow request')),
    failures: logLines.filter((line) => /proxy failed|request failed|background failed|close failed/.test(line)),
    backups: logLines.filter((line) => line.includes('"backup ')),
  };
  results.peaks = peaks(samples);
  clock.stop();
  results.clockSteps = clock.steps;
  writeFileSync(args.out, JSON.stringify(results, null, 2));
  say(`results in ${args.out}`);
  if (!args.keep) rmSync(dataDir, { recursive: true, force: true });
}
