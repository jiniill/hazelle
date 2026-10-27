import { rmSync } from 'node:fs';
import { baseIdsPath, CURRENT_BASELINE, RETENTION_MS, TAKES_BASELINE } from '../db/account-db';
import { snapshotKey } from '../files/bucket';
import { DAY_MS, type Services } from '../http';

// UTC baselines/retention. Yield between accounts so daily work cannot starve request handling.

// Shared pin rule for retention and generations: checkpoint/target stay pinned through operation completion
// and RETENTION_MS afterward, including failed/cancelled operations for manual recovery.
export const PINNED = (s: string, now: string) =>
  `EXISTS (SELECT 1 FROM restores r WHERE r.incarnation = ${s}.incarnation AND ${s}.id IN (r.checkpoint, r.target)
     AND (r.ended_at IS NULL OR r.ended_at > ${now} - ${RETENTION_MS}))`;

export const dayStart = (now: number) => now - (now % DAY_MS);
export const pass = () => new Promise<void>((resolve) => setImmediate(resolve));

// Select eligible missing/old current baselines, requiring at least today's baseline before a restoring account checkpoints.
// Only baselines prove present state; young undo checkpoints do not. Unchanged old baselines remain selected,
// but capture copies nothing. before > now selects every eligible account.
export async function staleBaselines(env: Services, now: number, before: number): Promise<string[]> {
  const { results } = await env.db
    .prepare(
      `SELECT incarnation FROM accounts a
       WHERE ${TAKES_BASELINE('a')}
         AND COALESCE((${CURRENT_BASELINE('taken_at', 'a', '?1')}), -1) < CASE a.state WHEN 'active' THEN ?2 ELSE MAX(?2, ?3) END
       ORDER BY incarnation`,
    )
    .bind(now, before, dayStart(now))
    .all<{ incarnation: string }>();
  return results.map(({ incarnation }) => incarnation);
}

// skipped: accounts that stopped taking a baseline between their selection and their turn. unchanged: those whose file
// still holds what their current baseline holds. failed: those whose snapshot threw.
export async function takeBaselines(env: Services, incarnations: string[]): Promise<{ taken: number; skipped: number; unchanged: number; failed: string[] }> {
  let taken = 0;
  let skipped = 0;
  let unchanged = 0;
  const failed: string[] = [];
  for (const incarnation of incarnations) {
    try {
      const outcome = await env.stores.snapshot(incarnation);
      if ('taken' in outcome) taken++;
      else if ('unchanged' in outcome) unchanged++;
      else skipped++;
    } catch {
      failed.push(incarnation);
    }
    await pass();
  }
  return { taken, skipped, unchanged, failed };
}

// Expire after RETENTION_MS except pins, delta bases and each live account's newest pre-window baseline (floor).
// The floor spans any timeline: pre-rewind times still need it, and unchanged accounts may have no newer copy.
// Clock rollback can leave an older timeline's later-stamped floor; landing has the same accepted ambiguity.
// Remove bases only after their last delta; departed accounts retain no floor. Disk generations keep hard links.
// For R2, queue deletion atomically with catalog removal, due after the newest naming generation expires
// (or immediately if none). Remove baseIdsPath with the row on either store.
export async function expireSnapshots(env: Services, dataDir: string, now: number, named: Map<string, number>): Promise<number> {
  const { results } = await env.db
    .prepare(
      `SELECT id, incarnation FROM snapshots s
       WHERE taken_at <= ?1 - ${RETENTION_MS}
         AND NOT ${PINNED('s', '?1')}
         AND NOT EXISTS (SELECT 1 FROM snapshots d WHERE d.incarnation = s.incarnation AND d.base = s.id)
         AND NOT (kind = 'baseline' AND EXISTS (SELECT 1 FROM accounts WHERE incarnation = s.incarnation)
           AND id = (SELECT id FROM snapshots WHERE incarnation = s.incarnation AND kind = 'baseline' AND taken_at <= ?1 - ${RETENTION_MS}
             ORDER BY taken_at DESC, id DESC LIMIT 1))
       ORDER BY incarnation`,
    )
    .bind(now)
    .all<{ id: string; incarnation: string }>();
  for (const { id, incarnation } of results) {
    const key = snapshotKey(incarnation, id);
    if (env.files.kind === 'r2') await env.db.batch([
      env.db.prepare('INSERT INTO snapshot_removals (key, due_at) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET due_at = excluded.due_at').bind(key, named.get(key) ?? now),
      env.db.prepare('DELETE FROM snapshots WHERE id = ?').bind(id),
    ]);
    else {
      await env.db.prepare('DELETE FROM snapshots WHERE id = ?').bind(id).run();
      await env.files.delete(key);
    }
    rmSync(baseIdsPath(dataDir, incarnation, id), { force: true });
    await pass();
  }
  return results.length;
}
