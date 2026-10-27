// Pictures and snapshot archives live in the data directory (disk-bucket.ts) or an R2 bucket
// (r2-bucket.ts), chosen at startup (choose.ts). Every reader of that layout goes through a Bucket.

type Common = {
  // Durable once either put answers: a catalog row is written only after publication.
  put(key: string, body: ArrayBuffer | Uint8Array): Promise<void>;
  putFile(key: string, path: string): Promise<void>;
  archives(): Promise<{ key: string; modified: number }[]>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string): Promise<void>;
  // Every incarnation's prefix that holds a picture, for the sweep of deleted accounts' pictures (reconcile.ts).
  prefixes(): Promise<string[]>;
};

// path: the file holding a key, which a backup generation hard-links into its pool. sweep: removes what a put cut off
// before settled left behind and answers those names.
export type DiskBucket = Common & { kind: 'disk'; path(key: string): string; sweep(settled: number): Promise<string[]> };
// R2 generations name remote objects rather than copying them. head must query the store itself, not its disk cache.
// trim evicts local cached pictures and reports removed names.
export type R2Bucket = Common & { kind: 'r2'; name: string; head(key: string): Promise<number | null>; trim(now: number): Promise<string[]> };
export type Bucket = DiskBucket | R2Bucket;

// The path-traversal guard: keys come from validated route params or generated snapshot ids; a miss is a programming error.
const KEY = /^files\/[0-9a-f]{32}\/[0-9a-f]{64}$/;
const SNAPSHOT_KEY = /^snapshots\/[0-9a-f]{32}\/[0-9]+-[0-9a-f]{12}\.sqlite\.gz$/;
const PREFIX = /^files\/[0-9a-f]{32}\/$/;

export function checkedKey(key: string): string {
  if (!isKey(key)) throw new Error(`Not a file key: ${key}`);
  return key;
}

export function checkedPrefix(prefix: string): string {
  if (!PREFIX.test(prefix)) throw new Error(`Not a file prefix: ${prefix}`);
  return prefix;
}

export const isKey = (key: string) => KEY.test(key) || SNAPSHOT_KEY.test(key);
export const isPrefix = (prefix: string) => PREFIX.test(prefix);
export const filePrefix = (incarnation: string) => `files/${incarnation}/`;
export const fileKey = (incarnation: string, id: string) => `${filePrefix(incarnation)}${id}`;

export const snapshotKey = (incarnation: string, id: string) => checkedKey(`snapshots/${incarnation}/${id}.sqlite.gz`);
