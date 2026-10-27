import { existsSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { join } from 'node:path';
import type { BackupWarning } from '../../contracts/admin';
import type { Services } from '../http';
import { COPIED, generationsDir, listGenerations, MANIFEST } from './generation';

// Single warning policy shared by admin UI and webhook; never decide freshness separately in callers.

const HOUR_MS = 60 * 60 * 1000;
const STALE_HOURS = 36;
const MIN_FREE_PERCENT = 20;

// backupAgeHours: since the newest complete generation was captured, null when none is. diskFreePercent: the lowest
// among the data directory and files/, which may be a filesystem of its own.
export type Freshness = { backupAgeHours: number | null; diskFreePercent: number; warnings: BackupWarning[] };
// Free space of the filesystem holding path, in percent. Tests give a fixed one: the machine running them has a disk of its own.
export type DiskFree = (path: string) => Promise<number>;

export async function freePercent(path: string): Promise<number> {
  const { bavail, blocks } = await statfs(path);
  return Math.floor((bavail / blocks) * 1000) / 10;
}

// Expect copies for hosted installs, configured backup folders, or Docker copiers evidenced by markers.
// Without a copier, do not invent an overdue copy; the UI instead reports disk-only backups.
export async function freshness(env: Services, dataDir: string, now: number, free: DiskFree, expectsCopies: boolean): Promise<Freshness> {
  const complete = (await listGenerations(dataDir))
    .filter(({ id }) => existsSync(join(generationsDir(dataDir), id, MANIFEST)) && existsSync(join(generationsDir(dataDir), id, COPIED)))
    .map(({ capturedAt }) => capturedAt);
  const backupAgeHours = complete.length ? Math.floor(((now - Math.max(...complete)) / HOUR_MS) * 10) / 10 : null;
  const files = join(dataDir, 'files');
  const diskFreePercent = Math.min(...(await Promise.all([dataDir, ...(existsSync(files) ? [files] : [])].map(free))));
  // With no complete generation yet, the installation's own age is how long it has gone without one.
  const unbackedHours =
    backupAgeHours ?? (expectsCopies ? (now - (await env.db.prepare('SELECT created_at FROM installation').first<number>('created_at'))!) / HOUR_MS : 0);
  const warnings: BackupWarning[] = [];
  if (unbackedHours > STALE_HOURS) warnings.push('backup-stale');
  if (diskFreePercent < MIN_FREE_PERCENT) warnings.push('disk-full');
  return { backupAgeHours, diskFreePercent, warnings };
}
