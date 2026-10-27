// A file's id is the SHA-256 of its sealed body (vault/files).
export const FILE_ID = /^[0-9a-f]{64}$/;
export const MAX_FILE_IDS = 1000;
// Limit sealed bytes in both server and guest stores so every guest file remains transferable on signup.
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
// Protect recently queried/uploaded files: imports claim files before saving the objects that name them.
export const CLAIM_SETTLE_MS = 60 * 60 * 1000;
// room null means no picture cap; maxBytes counts the sealed body.
export type MissingFiles = { missing: string[]; maxBytes: number; room: number | null };
// The files an account holds, a page at a time, on the timeline and revision its sweep weighs them against.
export type HeldFiles = { ids: string[]; more: boolean; timeline: string; rev: number };
// unused: held ids no object names, to release. named: ids objects name that the account does not hold.
export type FileSweep = { timeline: string; rev: number; unused: string[]; named: string[] };
export type SweptFiles = { released: number; taken: number };
