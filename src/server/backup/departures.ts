import { closeSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { RETENTION_MS } from '../db/account-db';
import { fsyncPath, makeDirs } from '../db/durable';
import { DAY_MS } from '../http';

// Keep departures.json outside the rewound service DB so disaster restore re-deletes departed accounts.
// Copier/restore scripts must move it beside generations. Synchronous reads/writes serialize this process's updates.

export const DEPARTURES = 'departures.json';

export type Departure = { account: string; incarnation: string; leftAt: number };

const isDeparture = (value: unknown): value is Departure => {
  const entry = value as Partial<Departure> | null;
  return typeof entry === 'object' && entry !== null && typeof entry.account === 'string' && typeof entry.incarnation === 'string' && Number.isSafeInteger(entry.leftAt);
};

// Null when the file is absent.
export function readDepartures(path: string): Departure[] | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let list: unknown = null;
  try {
    list = JSON.parse(text);
  } catch {
    // Reported below with the file's path.
  }
  if (!Array.isArray(list) || !list.every(isDeparture)) throw new Error(`${path} is not a list of departures`);
  return list;
}

export function writeDepartures(dir: string, list: Departure[]): void {
  makeDirs(dir);
  const temp = join(dir, `.tmp-${DEPARTURES}`);
  const fd = openSync(temp, 'w');
  try {
    writeSync(fd, JSON.stringify(list));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, join(dir, DEPARTURES));
  fsyncPath(dir);
}

const departures = (dir: string) => readDepartures(join(dir, DEPARTURES)) ?? [];

export function recordDeparture(dir: string, departure: Departure): void {
  const list = departures(dir);
  if (list.some(({ incarnation }) => incarnation === departure.incarnation)) return;
  writeDepartures(dir, [...list, departure]);
}

// Create beside every generation, including an empty ledger, so restore can detect a missing file.
// Prune only after every pre-departure generation expires (capture retention plus the daily pass).
export function expireDepartures(dir: string, now: number): void {
  writeDepartures(dir, departures(dir).filter(({ leftAt }) => leftAt > now - RETENTION_MS - DAY_MS));
}
