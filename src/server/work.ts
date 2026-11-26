import type { DatabaseSync } from 'node:sqlite';
import { workEnd, workHeader, type ServerWork } from '../contracts/work';

export const WORK_COLUMNS = 'work_at AS workAt, work_minutes AS workMinutes';
type Stored = { workAt: number | null; workMinutes: number | null };

// The work announced, until its announced end.
export function standingWork({ workAt, workMinutes }: Stored, now: number): ServerWork | null {
  const work = workAt === null ? null : { at: workAt, minutes: workMinutes! };
  return work && now < workEnd(work) ? work : null;
}

// A start after the work's start is the server back from it, so the work is done; one before it leaves it announced.
// Returns what every API answer says of it (WORK_HEADER).
export function openWork(db: DatabaseSync, clock: () => number = Date.now) {
  db.prepare('UPDATE service SET work_at = NULL, work_minutes = NULL WHERE work_at <= ?').run(clock());
  const stored = db.prepare(`SELECT ${WORK_COLUMNS} FROM service`);
  return () => workHeader(standingWork(stored.get() as Stored, clock()));
}
