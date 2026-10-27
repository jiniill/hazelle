import type { BatchLimits, SealedChange } from '../contracts/objects';

export type CacheState = {
  cursor: number;
  complete: boolean;
  until: number | null;
  limits: BatchLimits | null;
  heads: [string, number][];
  revisions: [string, number][];
};
export type CachedScope = { state: CacheState; changes: SealedChange[] };
export type CacheWrite = { changes: SealedChange[]; feed: CacheState; scopes?: { chat: string; state: CacheState }[] };

// The account's one cache generation, shared by every tab. id is new after every clear; timeline is the server's
// token, set once by adopt, and every row of a generation is of its timeline.
export type Generation = { id: string; timeline: string | null };

export class GenerationChanged extends Error {
  constructor() { super('The cache generation changed'); }
}

// Atomically commit ciphertext rows and cursors. Except open/forget, compare the caller generation inside
// each transaction so stale-tab clears/bootstrap cannot mutate the current cache.
export interface DeviceCache {
  // One without a timeline is a clear whose bootstrap has not answered yet, which a tab joins; none at all is a cache
  // from before generations, whose rows go as a new generation is made, in the same transaction.
  open(): Promise<{ generation: Generation; saved: CachedScope | null }>;
  read(generation: Generation, chat: string): Promise<CachedScope | null>;
  write(generation: Generation, write: CacheWrite): Promise<void>;
  // Every row goes, and the answer is the new generation, without a timeline.
  clear(generation: Generation): Promise<Generation>;
  // Sets the timeline of a generation that has none, or has this one already: two tabs may bootstrap one generation.
  adopt(generation: Generation, timeline: string): Promise<Generation>;
  // Logout: everything of the account goes, whatever generation is stored.
  forget(): Promise<void>;
}

export const SCOPED = new Set<string>(['entry', 'memory', 'illustration', 'inlay', 'textfile', 'toolchat', 'cacheprint', 'remark']);
// Never held: read only by walking their parent (ObjectStore.walk), which caches them under it as a chat scope is.
export const WALKED = new Set<string>(['ledger']);
// The kinds the feed carries without their bodies.
export const UNFED = new Set<string>([...SCOPED, ...WALKED]);
export const cacheScope = (row: SealedChange) => UNFED.has(row.kind) ? row.parent! : '';
// A newer omission invalidates the old body; a same-revision echo must not erase a body already cached.
export const cacheNewer = (old: SealedChange | undefined, row: SealedChange) => !old || row.rev > old.rev || (row.rev === old.rev && old.omitted && !row.omitted);
export const sameGeneration = (stored: Generation | undefined, stated: Generation) => stored !== undefined && stored.id === stated.id && stored.timeline === stated.timeline;
export const adoptable = (stored: Generation | undefined, stated: Generation, timeline: string) =>
  stored !== undefined && stored.id === stated.id && (stored.timeline === null || stored.timeline === timeline);
