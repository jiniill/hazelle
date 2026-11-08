
// bytes: the whole batch request, timeline included. The sizes date from the Cloudflare store (a 2 MB row, a 32 MiB RPC).
export const BATCH_LIMITS = { items: 200, bytes: 4_000_000, body: 1_500_000 };
export type BatchLimits = typeof BATCH_LIMITS;

// once creates are idempotent: a matching existing kind/parent returns its rev after a lost response.
export type SealedWrite = { id: string; kind: string; parent: string | null; body: string | null; baseRev: number | null; once?: true };
// body null: a deletion. omitted: a live row the query asked without its body.
export type SealedChange = { id: string; kind: string; parent: string | null; rev: number; body?: string | null; omitted?: true };
// count requests the whole-bootstrap total, not just the first page size.
export type FeedQuery = { timeline: string | null; since: number; known: number; until: number | null; bootstrap: boolean; metadata: boolean; excluded: string[]; parent: string | null; kind: string | null; count: boolean };
export type FeedAnswer = { limits: BatchLimits; timeline: string; until?: number; changes: SealedChange[]; cursor: number; more: boolean; total?: number };
export type BatchAnswer = { revs: number[]; timeline: string };

// A feed page stops at its row count or its body budget, always admitting its first row (server/account-store,
// runtime/guest-store). A metadata row is a hundred bytes, so a backup's walk over a whole account takes few round trips.
export const FEED_PAGE_BODY_BYTES = 4_000_000;
export const feedPageRows = ({ metadata }: Pick<FeedQuery, 'metadata'>) => (metadata ? 10_000 : 500);

export const KIND = /^[a-z][a-z-]{0,31}$/;
const utf8 = new TextEncoder();

// What both stores refuse of a batch whose writes are well formed (server/objects, runtime/guest-store).
export function refusedWrites(writes: SealedWrite[]): 'bad-input' | 'too-large' | null {
  if (writes.length > BATCH_LIMITS.items) return 'too-large';
  if (!writes.length || new Set(writes.map(({ id }) => id)).size < writes.length || !writes.every(validWrite)) return 'bad-input';
  return writes.some(({ body }) => body !== null && utf8.encode(body).length > BATCH_LIMITS.body) ? 'too-large' : null;
}

// A deletion names the rev it deletes; once is only a create's.
const validWrite = ({ kind, body, baseRev, once }: SealedWrite) =>
  KIND.test(kind) && body !== '' && (body !== null || baseRev !== null) && (!once || (body !== null && baseRev === null));
