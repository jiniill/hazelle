import type { BackupCopyFailure } from '../../contracts/admin';
import type { Alerts } from '../alerts';
import { DAY_MS, type Services } from '../http';
import { recordDeparture } from './departures';
import { checkFolder, copyToFolder } from './folder';
import { freePercent, freshness, type DiskFree, type Freshness } from './freshness';
import { captureGeneration, expireGenerations, generationsDir, namedArchives } from './generation';
import { dayStart, expireSnapshots, staleBaselines, takeBaselines } from './snapshots';

// The daily job, the gate a backup generation holds, and their record in backup_runs (docs/research/docker-port-plan.md
// §10). One job runs at a time.

const HOUR_MS = 60 * 60 * 1000;

type Outcome = { outcome: 'ok' | 'failed'; error: string | null };

// Where copies of the generations go: hazelle.app's Docker copier, which must be running; a self-host's in Docker, which
// may be; a self-host's backup folder (folder.ts), once one is set.
export type Copier = 'remote' | 'optional' | 'folder';

export type Backups = {
  // Capture and file/lifecycle holds exclude each other. Never nest holds: a queued capture can deadlock the inner hold.
  // Writes that name no files need no hold.
  hold<T>(work: () => Promise<T>): Promise<T>;
  // Capture once per UTC day after the configured hour; retry failed/missed captures on later ticks.
  // Baseline failures beside a completed generation wait until tomorrow and raise alerts.
  // Then copy missing generations and send each persistent alert at most once per UTC day.
  tick(env: Services, now: number): Promise<void>;
  freshness(env: Services, now: number): Promise<Freshness>;
  daily(env: Services, now: number): Promise<{ snapshots: Outcome; generation: Outcome }>;
  // Wait out existing jobs, then start a fresh capture covering every live account now, not today's old baseline.
  // Any failed baseline must fail this generation rather than publish an older account state.
  fresh(env: Services): Promise<{ snapshots: Outcome; generation: Outcome }>;
  // Records an account's departure (departures.ts), durably, before any of it is destroyed.
  depart(account: string, incarnation: string, at: number): void;
  copier: Copier;
  checkFolder(typed: string): ReturnType<typeof checkFolder>;
  // Why the last pass to the backup folder failed; null after one that did not, and before the first.
  copyFailure(): BackupCopyFailure | null;
};

const FAILURES: Record<string, BackupCopyFailure> = { ENOENT: 'missing', EACCES: 'denied', EPERM: 'denied', EROFS: 'denied', ENOSPC: 'full' };

export const savedFolder = async (env: Services) => env.db.prepare('SELECT backup_folder FROM service').first<string | null>('backup_folder');

export function backups(dataDir: string, hour: number, alerts: Alerts, free: DiskFree = freePercent, copier: Copier = 'remote'): Backups {
  let holds = 0;
  let copyFailure: BackupCopyFailure | null = null;
  let capturing: Promise<void> | null = null;
  let drained: (() => void) | null = null;
  let running: ReturnType<Backups['daily']> | null = null;
  let ticking: Promise<void> | null = null;

  const hold = async <T>(work: () => Promise<T>): Promise<T> => {
    while (capturing) await capturing;
    holds++;
    try {
      return await work();
    } finally {
      if (--holds === 0) drained?.();
    }
  };

  const exclusive = async <T>(work: () => Promise<T>) => {
    const asked = Date.now();
    let release = () => {};
    capturing = new Promise((resolve) => (release = resolve));
    try {
      if (holds > 0) await new Promise<void>((resolve) => (drained = resolve));
      drained = null;
      const value = await work();
      return { value, gateMs: Date.now() - asked };
    } finally {
      capturing = null;
      release();
    }
  };

  const recorded = async (env: Services, kind: string, clock: () => number, work: () => Promise<{ error: string | null; detail: object; generation?: string; gateMs?: number }>): Promise<Outcome> => {
    const begun = clock();
    const id = (await env.db.prepare("INSERT INTO backup_runs (kind, started_at, outcome) VALUES (?, ?, 'running') RETURNING id").bind(kind, begun).first<number>('id'))!;
    let ended: Awaited<ReturnType<typeof work>>;
    try {
      ended = await work();
    } catch (thrown) {
      ended = { error: 'job-failed', detail: { message: String(thrown) } };
    }
    const outcome = ended.error === null ? ('ok' as const) : ('failed' as const);
    await env.db
      .prepare('UPDATE backup_runs SET ended_at = ?, outcome = ?, error = ?, detail = ?, generation = ?, gate_ms = ? WHERE id = ?')
      .bind(clock(), outcome, ended.error, JSON.stringify(ended.detail), ended.generation ?? null, ended.gateMs ?? null, id)
      .run();
    return { outcome, error: ended.error };
  };

  const job = (env: Services, now: number, fresh: boolean) => {
    running ??= (async () => {
      // Monotonic: the wall clock can step back mid-job, and the job's clock must never fall behind the baselines it
      // stamped at `now`, or the generation finds no current baseline for them.
      const started = performance.now();
      const clock = () => now + Math.round(performance.now() - started);
      const snapshots = await recorded(env, 'daily', clock, async () => {
        const { taken, skipped, unchanged, failed } = await takeBaselines(env, await staleBaselines(env, now, fresh ? now + 1 : dayStart(now)));
        const expired = await expireSnapshots(env, dataDir, now, await namedArchives(dataDir));
        return { error: failed.length ? 'baseline-failed' : null, detail: { taken, skipped, unchanged, failed: failed.length, expired } };
      });
      const generation = await recorded(env, 'generation', clock, async () => {
        if (fresh && snapshots.outcome === 'failed') return { error: 'baseline-failed', detail: {} };
        const { id, gateMs, manifest } = await captureGeneration(env, dataDir, now, clock, exclusive);
        const expired = await expireGenerations(dataDir, now);
        return { error: null, generation: id, gateMs, detail: { accounts: manifest.accounts.length, pictures: manifest.pictures.length, expired } };
      });
      return { snapshots, generation };
    })().finally(() => {
      running = null;
    });
    return running;
  };

  const expectsCopies = async (env: Services) => copier === 'remote' || (copier === 'folder' && (await savedFolder(env)) !== null);
  const readFreshness = async (env: Services, now: number) => freshness(env, dataDir, now, free, await expectsCopies(env));

  const copyOut = async (env: Services, now: number) => {
    const folder = await savedFolder(env);
    try {
      if (folder !== null) await copyToFolder(dataDir, folder, now);
      copyFailure = null;
    } catch (error) {
      copyFailure = FAILURES[(error as NodeJS.ErrnoException).code ?? ''] ?? 'failed';
      console.error('backup folder copy failed', String(error));
    }
  };

  const alert = async (env: Services, now: number) => {
    const day = dayStart(now);
    const failed = await env.db.prepare("SELECT 1 FROM backup_runs WHERE outcome = 'failed' AND started_at >= ?1 AND started_at < ?1 + ?2").bind(day, DAY_MS).first();
    const standing = [...(await readFreshness(env, now)).warnings, ...(failed === null ? [] : ['job-failed' as const])];
    for (const condition of standing) await alerts.send(env, condition, now);
  };

  const daily = (env: Services, now: number) => job(env, now, false);

  return {
    hold,
    daily,
    fresh: async (env) => {
      while (running) await running;
      return job(env, Date.now(), true);
    },
    freshness: readFreshness,
    depart: (account, incarnation, at) => recordDeparture(generationsDir(dataDir), { account, incarnation, leftAt: at }),
    copier,
    checkFolder: (typed) => checkFolder(dataDir, typed),
    copyFailure: () => copyFailure,
    // One tick at a time: a second that comes while one runs gets that one, so no alert goes out twice. Today is the
    // UTC day itself, not "from its start on": a run stamped by a clock since put back belongs to no day yet.
    tick: (env, now) =>
      (ticking ??= (async () => {
        if (now - dayStart(now) >= hour * HOUR_MS) {
          const done = await env.db
            .prepare("SELECT 1 FROM backup_runs WHERE kind = 'generation' AND outcome = 'ok' AND started_at >= ?1 AND started_at < ?1 + ?2")
            .bind(dayStart(now), DAY_MS)
            .first();
          if (done === null) await daily(env, now);
        }
        if (copier === 'folder') await copyOut(env, now);
        await alert(env, now);
      })().finally(() => {
        ticking = null;
      })),
  };
}
