
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
