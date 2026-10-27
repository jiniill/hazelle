import type { Bucket } from './bucket';
import { cachedR2Bucket } from './cached-r2-bucket';
import { diskBucket } from './disk-bucket';
import { r2Bucket } from './r2-bucket';

const DEFAULT_CACHE_BYTES = 20 * 1024 ** 3;

// Blank/unset store uses data/ (compose passes empty strings). Reject incomplete/invalid configuration at startup;
// never silently write to a store the operator did not choose.
export function chooseBucket(env: NodeJS.ProcessEnv, dataDir: string): Bucket {
  const kind = env.HAZELLE_FILES_BUCKET?.trim() || 'disk';
  if (kind === 'disk') return diskBucket(dataDir);
  if (kind !== 'r2') throw new Error(`HAZELLE_FILES_BUCKET must be disk or r2: ${kind}`);
  const named = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`HAZELLE_FILES_BUCKET=r2 needs ${name}`);
    return value;
  };
  const endpoint = named('HAZELLE_FILES_R2_ENDPOINT');
  if (!URL.canParse(endpoint)) throw new Error(`HAZELLE_FILES_R2_ENDPOINT is not a URL: ${endpoint}`);
  const store = r2Bucket({
    endpoint,
    bucket: named('HAZELLE_FILES_R2_BUCKET'),
    accessKeyId: named('HAZELLE_FILES_R2_ACCESS_KEY_ID'),
    secretAccessKey: named('HAZELLE_FILES_R2_SECRET_ACCESS_KEY'),
  });
  const cap = env.HAZELLE_FILES_CACHE_BYTES?.trim() || String(DEFAULT_CACHE_BYTES);
  if (!/^\d+$/.test(cap) || !Number.isSafeInteger(Number(cap))) throw new Error(`HAZELLE_FILES_CACHE_BYTES must be a whole number of bytes, 0 for no cache: ${cap}`);
  // Wrapped even at 0, which copies nothing but still trims: what an earlier run copied must still go at the idle limit.
  return cachedR2Bucket(store, dataDir, Number(cap));
}
