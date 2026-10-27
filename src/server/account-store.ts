import type { AccountState } from '../contracts/admin';
import type { FeedQuery, SealedChange, SealedWrite } from '../contracts/objects';
import { ROW_BYTES, SHARED_BYTES } from './caps';
import type { Db } from './db/service-db';
import { isRecord } from './http';
// The rules of one account's store over its database file (db/account-db.ts); nothing here touches a file directly.

export type Life = { state: AccountState | 'gone'; timeline: string | null; operation: number | null };
export type Unavailable = { unavailable: true };
// unavailable: the wake's service read failed, timed out or answered something that is neither a row nor no row, or
// the account's file is missing, corrupt or of a newer schema.
export type Refused = { refused: 'restoring' | 'leaving' | 'gone' } | Unavailable;
export type FeedPage = { timeline: string; bytes: number; until: number | null; changes: SealedChange[]; cursor: number; more: boolean; total?: number };
type WrongPhase = { wrongPhase: true };

export type SqlValue = string | number | null;

// Transactions roll back on throw; wipe deletes live data/kv but not catalogued snapshots.
// Only db/account-db installs an armed snapshot on store start.
export type StoreDb = {
  exec<T>(sql: string, ...binds: SqlValue[]): T[];
  transaction<T>(fn: () => T): T;
  wipe(): Promise<void>;
  kv: { get(key: string): unknown; put(key: string, value: string): void; delete(key: string): boolean };
  size(): number;
  snapshots: {
    // Answers the snapshot's id once its file is durable and catalogued.
    take(operation: number): Promise<string>;
    // The snapshot a rewind to the time lands on (db/account-db.ts snapshotFor); null when there is none.
    forTime(at: number): Promise<string | null>;
    // Throws when the snapshot's file is gone or no longer what its catalog row recorded.
    verify(id: string): Promise<void>;
  };
};

// The account's lifecycle, which lives in the service database where a rewind of this store cannot touch it. Each
// answers the row as read; the rules decide what a row means.
export type StoreReads = {
  life(incarnation: string): Promise<unknown>;
  phase(incarnation: string, operation: number): Promise<unknown>;
  shared(incarnation: string): Promise<unknown>;
};

export const serviceReads = (db: Db): StoreReads => ({
  life: (incarnation) => db.prepare('SELECT state, timeline, operation FROM accounts WHERE incarnation = ?').bind(incarnation).first(),
  phase: (incarnation, operation) => db.prepare('SELECT phase FROM restores WHERE id = ? AND incarnation = ?').bind(operation, incarnation).first('phase'),
  shared: (incarnation) => db.prepare(SHARED_BYTES).bind(incarnation).first('bytes'),
});

const PAGE_ROWS = 500;
// A metadata row is a hundred bytes, so a backup's walk over a whole account takes few round trips.
const METADATA_PAGE_ROWS = 10_000;
const PAGE_BODY_BYTES = 4_000_000;
// How far past its cap an account's updates may still grow it, so a full account can still mark what it means to delete
// (휴지통's mark: a body that grows a little), while nothing new is created. The account's bytes never
// pass cap + this.
const FULL_MARGIN = 1_000_000;
// A service read that has not settled by then answers unavailable instead of holding the account's queue.
const READ_MS = 5_000;

type Head = { rev: number; bytes: number; timeline: string };
type Row = { id: string; kind: string; parent_id: string | null; rev: number; deleted: number; fits: number; omitted: number; body: string | null };

const unavailable = (): Unavailable => ({ unavailable: true });
const markKey = (operation: number) => `restore:${operation}`;

export class StoreRules {
  // Kept until the object restarts; never an unavailable answer, so the next call reads the service again.
  private life: Life | null = null;

  constructor(
    private readonly db: StoreDb,
    private readonly reads: StoreReads,
    // Holds every other call of this store until the load settles.
    private readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>,
  ) {}

  status(incarnation: string): Promise<Life | Unavailable> {
    return this.lifecycle(incarnation);
  }

  async revision(incarnation: string): Promise<Refused | { timeline: string; rev: number }> {
    const life = await this.lifecycle(incarnation);
    if (!active(life)) return refusal(life);
    const { timeline, rev } = this.head();
    return { timeline, rev };
  }

  async feed(incarnation: string, query: FeedQuery): Promise<Refused | { stale: true } | { reset: true } | FeedPage> {
    const life = await this.lifecycle(incarnation);
    if (!active(life)) return refusal(life);
    const shared = await this.shared(incarnation);
    if (shared === null) return unavailable();
    return this.db.transaction(() => {
      const head = this.head();
      // No timeline: a device that holds nothing yet, and only its first page may come without one.
      if (query.timeline === null ? query.since !== 0 || query.known !== 0 : query.timeline !== head.timeline) return { stale: true };
      const until = query.bootstrap ? (query.until ?? head.rev) : null;
      // An operator wipe/restore can move revisions backwards. Never merge that account with a newer device snapshot.
      if (Math.max(query.since, query.known, until ?? 0) > head.rev) return { reset: true };
      // Bound rows and body bytes, always admitting the first row; over-budget rows omit bodies to signal more data.
      // Limit candidates before the window sum, not outside it. Cast body to BLOB: text LENGTH counts characters
      // and stops at NUL, undercounting the byte budget.
      const excluded = JSON.stringify(query.excluded);
      const pageRows = query.metadata ? METADATA_PAGE_ROWS : PAGE_ROWS;
      const rows = this.db.exec<Row>(
        `SELECT id, kind, parent_id, rev, deleted_at IS NOT NULL AS deleted, omitted, start < ? AS fits, CASE WHEN start < ? THEN body END AS body
         FROM (
           SELECT *, SUM(size) OVER (ORDER BY rev) - size AS start
           FROM (SELECT *, COALESCE(LENGTH(CAST(body AS BLOB)), 0) AS size
           FROM (
             SELECT id, kind, parent_id, rev, deleted_at,
               (kind IN (SELECT value FROM json_each(?)) OR ${query.metadata ? 1 : 0}) AND deleted_at IS NULL AS omitted,
               CASE WHEN kind NOT IN (SELECT value FROM json_each(?)) AND ${query.metadata ? 0 : 1} THEN body END AS body
             FROM objects WHERE rev > ?
               ${query.parent === null ? '' : 'AND parent_id = ?'}
               ${query.kind === null ? '' : 'AND kind = ?'}
               ${until === null ? '' : 'AND kind NOT IN (SELECT value FROM json_each(?)) AND rev <= ?'}
             ORDER BY rev LIMIT ?
           ))
         ) ORDER BY rev`,
        ...[PAGE_BODY_BYTES, PAGE_BODY_BYTES, excluded, excluded, query.since],
        ...(query.parent === null ? [] : [query.parent]),
        ...(query.kind === null ? [] : [query.kind]),
        ...(until === null ? [] : [excluded, until]),
        pageRows + 1,
      );
      const page: Row[] = [];
      for (const row of rows) {
        if (page.length === pageRows || !row.fits) break;
        page.push(row);
      }
      const total = query.count && until !== null
        ? this.db.exec<{ n: number }>(
          `SELECT COUNT(*) AS n FROM objects WHERE rev > ? AND rev <= ? AND kind NOT IN (SELECT value FROM json_each(?))${query.parent === null ? '' : ' AND parent_id = ?'}${query.kind === null ? '' : ' AND kind = ?'}`,
          query.since, until, excluded, ...(query.parent === null ? [] : [query.parent]), ...(query.kind === null ? [] : [query.kind]),
        )[0]!.n
        : undefined;
      return {
        ...(total === undefined ? {} : { total }),
        timeline: head.timeline,
        bytes: this.billed(head.bytes, shared),
        until,
        changes: page.map((row): SealedChange => ({ id: row.id, kind: row.kind, parent: row.parent_id, rev: row.rev, ...(row.omitted ? { omitted: true } : { body: row.deleted ? null : row.body }) })),
        cursor: page.at(-1)?.rev ?? query.since,
        more: rows.length > page.length,
      };
    });
  }

  // One transaction assigns revs in write order and updates head.bytes. Parent changes are bad input, not retryable conflicts.
  // Deletions retain bodyless rows for sync; writing at their current rev restores them.
  // Creates must fit the session cap; update/delete-only batches get FULL_MARGIN. Non-growing batches always pass
  // so full accounts can delete; null means uncapped. Enforce billed usage, not body bytes alone.
  async batch(incarnation: string, timeline: string, writes: SealedWrite[], cap: number | null): Promise<Refused | { stale: true } | { refused: 'bad-input' | 'conflict' | 'storage-full' } | { revs: number[]; bytes: number; timeline: string }> {
    const life = await this.lifecycle(incarnation);
    if (!active(life)) return refusal(life);
    // Read on the account's queue, which share publication also takes, so no link lands between it and the write.
    const shared = await this.shared(incarnation);
    if (shared === null) return unavailable();
    // No read outside this transaction decides whether to write; a later item's conflict must leave even head.rev
    // untouched.
    return this.db.transaction(() => {
      const head = this.head();
      if (timeline !== head.timeline) return { stale: true };
      const landed = new Map<string, number>();
      for (const { id, kind, parent, once } of writes) {
        if (!once) continue;
        const [row] = this.db.exec<{ rev: number }>('SELECT rev FROM objects WHERE id = ? AND kind = ? AND parent_id IS ? AND body IS NOT NULL', id, kind, parent);
        if (row) landed.set(id, row.rev);
      }
      const fresh = writes.filter(({ id }) => !landed.has(id));
      if (!fresh.length) return { revs: writes.map(({ id }) => landed.get(id)!), bytes: this.billed(head.bytes, shared), timeline: head.timeline };
      const checks = JSON.stringify(fresh.map(({ id, kind, parent, baseRev, body }) => ({ id, kind, parent, baseRev, remove: body === null })));
      const moved = `o.id IS NOT NULL AND o.parent_id IS NOT json_extract(w.value, '$.parent')`;
      // replaced: the bytes of the bodies these writes replace, counted as the migration counted them.
      const [found] = this.db.exec<{ moved: number; conflict: number; replaced: number }>(
        `SELECT
           MAX(json_extract(w.value, '$.baseRev') IS NOT NULL AND ${moved}) AS moved,
           MAX(CASE WHEN json_extract(w.value, '$.baseRev') IS NULL THEN o.id IS NOT NULL
             ELSE o.id IS NULL OR o.kind != json_extract(w.value, '$.kind')
               OR o.rev != json_extract(w.value, '$.baseRev') OR ${moved}
               OR (json_extract(w.value, '$.remove') AND o.body IS NULL) END) AS conflict,
           COALESCE(SUM(LENGTH(CAST(o.body AS BLOB))), 0) AS replaced
         FROM json_each(?) AS w LEFT JOIN objects AS o ON o.id = json_extract(w.value, '$.id')`,
        checks,
      );
      if (found!.moved) return { refused: 'bad-input' };
      if (found!.conflict) return { refused: 'conflict' };
      const encoder = new TextEncoder();
      const added = fresh.reduce((sum, { body }) => sum + (body === null ? 0 : encoder.encode(body).length), 0);
      const bytes = head.bytes + added - found!.replaced;
      // A create is the only write that adds a row: a delete keeps it, a restore and an update reuse it.
      const rows = fresh.filter(({ baseRev }) => baseRev === null).length * ROW_BYTES.object;
      const billed = this.billed(bytes, shared) + rows;
      const margin = rows ? 0 : FULL_MARGIN;
      if (added + rows > found!.replaced && cap !== null && billed > cap + margin) return { refused: 'storage-full' };
      this.db.exec('UPDATE head SET rev = ?, bytes = ?', head.rev + fresh.length, bytes);
      const written = fresh.map((_, index) => head.rev + index + 1);
      fresh.forEach(({ id, kind, parent, body }, index) =>
        this.db.exec(
          `INSERT INTO objects (id, kind, parent_id, rev, body, deleted_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET rev = excluded.rev, body = excluded.body, deleted_at = excluded.deleted_at`,
          id, kind, parent, written[index]!, body, body === null ? Date.now() : null,
        ),
      );
      let next = 0;
      return { revs: writes.map(({ id }) => landed.get(id) ?? written[next++]!), bytes: billed, timeline: head.timeline };
    });
  }

  async usage(incarnation: string): Promise<Refused | { bytes: number; disk: number }> {
    const life = await this.lifecycle(incarnation);
    if (!active(life)) return refusal(life);
    const shared = await this.shared(incarnation);
    if (shared === null) return unavailable();
    return { bytes: this.billed(this.head().bytes, shared), disk: this.db.size() };
  }

  async checkpoint(incarnation: string, operation: number): Promise<Refused | WrongPhase | { checkpoint: string }> {
    return (await this.restoring(incarnation, operation)) ?? { checkpoint: await this.db.snapshots.take(operation) };
  }

  async target(incarnation: string, operation: number, from: { at: number } | { snapshot: string }): Promise<Refused | WrongPhase | { target: string } | { tooEarly: true }> {
    const refused = await this.restoring(incarnation, operation);
    if (refused) return refused;
    if ('snapshot' in from) {
      await this.db.snapshots.verify(from.snapshot);
      return { target: from.snapshot };
    }
    const target = await this.db.snapshots.forTime(from.at);
    return target === null ? { tooEarly: true } : { target };
  }

  async mark(incarnation: string, operation: number): Promise<Refused | WrongPhase | { marked: true }> {
    const refused = await this.restoring(incarnation, operation);
    if (refused) return refused;
    this.db.kv.put(markKey(operation), 'marked');
    return { marked: true };
  }

  // The mark is the operation's own key, so reading or deleting it is safe whichever operation holds the account, and
  // a cancel deletes it after the account is active again.
  async unmark(incarnation: string, operation: number): Promise<Refused | { unmarked: true }> {
    const refused = await this.stored(incarnation);
    if (refused) return refused;
    this.db.kv.delete(markKey(operation));
    return { unmarked: true };
  }

  // Require both this operation's installedFrom/installedOp and absent mark. Absence alone proves nothing:
  // a pre-mark snapshot never held the mark.
  async marked(incarnation: string, operation: number): Promise<Refused | { marked: boolean; installedFrom: string | null; installedOp: number | null }> {
    const refused = await this.stored(incarnation);
    if (refused) return refused;
    const [head] = this.db.exec<{ installed_from: string | null; installed_op: number | null }>('SELECT installed_from, installed_op FROM head');
    return { marked: this.db.kv.get(markKey(operation)) !== undefined, installedFrom: head?.installed_from ?? null, installedOp: head?.installed_op ?? null };
  }

  // Reread service phase inside the call so stale/losing runners cannot rewind after cancellation.
  // The armed row is the instruction; db/account-db installs it on restart.
  async arm(incarnation: string, operation: number, target: string): Promise<Refused | WrongPhase | { returned: string }> {
    const refused = await this.restoring(incarnation, operation);
    if (refused) return refused;
    let phase: unknown;
    try {
      phase = await settles(this.reads.phase(incarnation, operation));
    } catch {
      return unavailable();
    }
    if (phase !== 'armed') return { wrongPhase: true };
    return { returned: target };
  }

  async destroy(incarnation: string): Promise<Refused | { destroyed: true }> {
    const life = await this.lifecycle(incarnation);
    if ('unavailable' in life) return life;
    if (life.state === 'active') throw new Error('destroy() empties only a leaving account.');
    if (life.state !== 'leaving') return { refused: life.state };
    await this.db.wipe();
    return { destroyed: true };
  }

  private head() {
    return this.db.exec<Head>('SELECT rev, bytes, timeline FROM head')[0]!;
  }

  // head.bytes stays the bodies alone, as every existing file holds it: the rows and the links are counted when read,
  // so no file needs an upgrade.
  private billed(bodies: number, shared: number) {
    return bodies + ROW_BYTES.object * this.db.exec<{ n: number }>('SELECT COUNT(*) AS n FROM objects')[0]!.n + shared;
  }

  private async shared(incarnation: string): Promise<number | null> {
    try {
      const bytes = await settles(this.reads.shared(incarnation));
      return Number.isSafeInteger(bytes) ? (bytes as number) : null;
    } catch {
      return null;
    }
  }

  private async lifecycle(incarnation: string): Promise<Life | Unavailable> {
    return this.life ?? this.exclusive(async () => this.life ?? this.load(incarnation));
  }

  // Only a confirmed absent service row means gone. Missing/corrupt/newer active files mean unavailable, never empty.
  // Signup/restore create files, not wake. Set head.timeline before serving any rewound response.
  private async load(incarnation: string): Promise<Life | Unavailable> {
    let row: unknown;
    try {
      row = await settles(this.reads.life(incarnation));
    } catch {
      return unavailable();
    }
    const life = row === null ? { state: 'gone' as const, timeline: null, operation: null } : readLife(row);
    if (!life) return unavailable();
    if (life.state === 'active') {
      try {
        if (this.db.exec<{ n: number }>('UPDATE head SET timeline = ? WHERE id = 1 RETURNING 1 AS n', life.timeline).length !== 1) return unavailable();
      } catch {
        return unavailable();
      }
    }
    this.life = life;
    return life;
  }

  private async restoring(incarnation: string, operation: number): Promise<Refused | WrongPhase | null> {
    const life = await this.lifecycle(incarnation);
    if ('unavailable' in life) return life;
    if (life.state === 'leaving' || life.state === 'gone') return { refused: life.state };
    return life.state === 'restoring' && life.operation === operation ? null : { wrongPhase: true };
  }

  private async stored(incarnation: string): Promise<Refused | null> {
    const life = await this.lifecycle(incarnation);
    if ('unavailable' in life) return life;
    return life.state === 'leaving' || life.state === 'gone' ? { refused: life.state } : null;
  }
}

function active(life: Life | Unavailable): life is Life & { state: 'active' } {
  return !('unavailable' in life) && life.state === 'active';
}

function refusal(life: Life | Unavailable): Refused {
  return 'unavailable' in life ? life : { refused: life.state as 'restoring' | 'leaving' | 'gone' };
}

function readLife(row: unknown): Life | null {
  if (!isRecord(row)) return null;
  const { state, timeline, operation } = row;
  if (state !== 'active' && state !== 'restoring' && state !== 'leaving') return null;
  if (typeof timeline !== 'string' || (operation !== null && !Number.isSafeInteger(operation))) return null;
  return { state, timeline, operation: operation as number | null };
}

async function settles<T>(read: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The service read took too long.')), READ_MS);
  });
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}
