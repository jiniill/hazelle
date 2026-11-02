import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../http';
import { snapshotKey, type Bucket } from './bucket';
import { cachedR2Bucket } from './cached-r2-bucket';
import { chooseBucket } from './choose';
import { diskBucket } from './disk-bucket';
import { fakeS3 } from './fake-s3';
import { r2Bucket } from './r2-bucket';

const INCARNATION = 'a'.repeat(32);
const OTHER = 'b'.repeat(32);
const PREFIX = `files/${INCARNATION}/`;
const key = (char: string, prefix = PREFIX) => `${prefix}${char.repeat(64)}`;
const read = async (bucket: Bucket, at: string) => new Uint8Array(await new Response(await bucket.get(at)).arrayBuffer());

let dir = '';
let s3: Awaited<ReturnType<typeof fakeS3>>;
beforeAll(async () => {
  s3 = await fakeS3();
});
afterAll(() => s3.close());
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
  s3.objects.clear();
  s3.requests.length = 0;
});

const kinds = {
  disk: () => {
    dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
    return diskBucket(dir);
  },
  r2: () => r2Bucket(s3.config),
  cached: () => {
    dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
    return cachedR2Bucket(r2Bucket(s3.config), dir, 1 << 20);
  },
};

describe.each(Object.entries(kinds))('the %s bucket', (_, fresh) => {
  it('streams a file archive through the store without entering the picture cache', async () => {
    const bucket = fresh();
    if (!dir) dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
    const source = join(dir, 'source.gz');
    const target = join(dir, 'download.gz');
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(123);
    writeFileSync(source, bytes);
    const at = snapshotKey(INCARNATION, '123-abcdef012345');
    await bucket.putFile(at, source);
    await pipeline((await bucket.get(at))!, createWriteStream(target));
    // equals, not toEqual: a deep compare walks 2 MiB byte by byte and outlasts the test's timeout on CI.
    expect(readFileSync(target).equals(bytes)).toBe(true);
    expect((await bucket.archives()).map(({ key }) => key)).toEqual([at]);
    expect(existsSync(join(dir, 'cache'))).toBe(false);
    await bucket.delete(at);
    expect(await bucket.get(at)).toBeNull();
    await expect(bucket.putFile(`snapshots/${INCARNATION}/../source.gz`, source)).rejects.toThrow(/Not a file key/);
  });

  it('answers the bytes it was given, and null for an absent key', async () => {
    const bucket = fresh();
    await bucket.put(key('1'), new Uint8Array([1, 2, 3]));
    await bucket.put(key('2'), new Uint8Array([4]).buffer);
    expect(await read(bucket, key('1'))).toEqual(new Uint8Array([1, 2, 3]));
    expect(await read(bucket, key('2'))).toEqual(new Uint8Array([4]));
    expect(await bucket.get(key('3'))).toBeNull();
  });

  it('lists keys sorted across pages, names each prefix once, and deletes one key or the whole prefix', async () => {
    const bucket = fresh();
    for (const char of ['c', 'a', 'b']) await bucket.put(key(char), new Uint8Array([1]));
    for (const char of ['d', 'e', 'f']) await bucket.put(key(char, `files/${OTHER}/`), new Uint8Array([1]));
    expect(await bucket.list(PREFIX)).toEqual([key('a'), key('b'), key('c')]);
    expect(await bucket.prefixes()).toEqual([PREFIX, `files/${OTHER}/`]);
    await bucket.delete(key('b'));
    await bucket.delete(key('b'));
    expect(await bucket.list(PREFIX)).toEqual([key('a'), key('c')]);
    await bucket.deletePrefix(PREFIX);
    expect(await bucket.list(PREFIX)).toEqual([]);
    expect(await bucket.prefixes()).toEqual([`files/${OTHER}/`]);
  });

  it('throws on a key or a prefix outside the layout', async () => {
    const bucket = fresh();
    await expect(bucket.put(`files/${INCARNATION}/../${'a'.repeat(64)}`, new Uint8Array())).rejects.toThrow(/Not a file key/);
    await expect(bucket.get(`files/${INCARNATION}/${'A'.repeat(64)}`)).rejects.toThrow(/Not a file key/);
    await expect(bucket.deletePrefix('files/')).rejects.toThrow(/Not a file prefix/);
  });
});

it('the disk bucket leaves no temp file and sweeps only a settled one', async () => {
  const bucket = kinds.disk();
  await bucket.put(key('a'), new Uint8Array([1]));
  expect(readdirSync(join(dir, PREFIX))).toEqual(['a'.repeat(64)]);
  for (const name of ['.tmp-old', '.tmp-new']) writeFileSync(join(dir, PREFIX, name), 'x');
  utimesSync(join(dir, PREFIX, '.tmp-old'), 1, 1);
  expect(await bucket.sweep(Date.now() - 60_000)).toEqual([`${PREFIX}.tmp-old`]);
});

it('the r2 bucket lists a prefix’s sizes across pages without a HEAD, and a refusal names the request', async () => {
  const bucket = r2Bucket(s3.config);
  await bucket.put(key('a'), new Uint8Array([1, 2, 3]));
  await bucket.put(key('b'), new Uint8Array([4]));
  await bucket.put(key('c'), new Uint8Array(1500));
  await bucket.put(key('d', `files/${OTHER}/`), new Uint8Array([5, 6]));
  s3.requests.length = 0;
  expect(await bucket.sizes(PREFIX)).toEqual(new Map([[key('a'), 3], [key('b'), 1], [key('c'), 1500]]));
  expect(s3.requests).toEqual(['GET /pictures/', 'GET /pictures/']);
  expect(await bucket.sizes(`files/${'c'.repeat(32)}/`)).toEqual(new Map());
  await expect(r2Bucket({ ...s3.config, secretAccessKey: 'wrong' }).get(key('a'))).rejects.toThrow(`r2: get ${key('a')} answered 403`);
});

describe('the cache in front of R2', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const NOW = 1_800_000_000_000;
  const fresh = (cap = 1 << 20) => {
    dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
    return cachedR2Bucket(r2Bucket(s3.config), dir, cap);
  };
  const cached = () => (existsSync(join(dir, 'cache')) ? readdirSync(join(dir, 'cache')).sort() : []);
  const reads = () => s3.requests.filter((request) => request.startsWith('GET /pictures/files/')).length;
  const used = (name: string, at: number) => utimesSync(join(dir, 'cache', name), at / 1000, at / 1000);

  it('reads a miss from R2 once, then serves every account holding the id from disk; only a whole read counts as use', async () => {
    const bucket = fresh();
    const bytes = new Uint8Array([1, 2, 3]);
    const id = sha256Hex(bytes);
    s3.objects.set(`${PREFIX}${id}`, bytes);
    expect(await read(bucket, `${PREFIX}${id}`)).toEqual(bytes);
    expect(await read(bucket, `files/${OTHER}/${id}`)).toEqual(bytes);
    expect(reads()).toBe(1);
    expect(cached()).toEqual([id]);

    used(id, 1000);
    await (await bucket.get(`${PREFIX}${id}`))!.cancel();
    expect(statSync(join(dir, 'cache', id)).mtimeMs).toBe(1000);
    await read(bucket, `${PREFIX}${id}`);
    await vi.waitFor(() => expect(statSync(join(dir, 'cache', id)).mtimeMs).toBeGreaterThan(1000));
  });

  it('keeps nothing of a body that does not hash to its id, nor of one cut off or cancelled', async () => {
    const bucket = fresh();
    const wrong = `${PREFIX}${'a'.repeat(64)}`;
    s3.objects.set(wrong, new Uint8Array([9]));
    expect(await read(bucket, wrong)).toEqual(new Uint8Array([9]));

    const whole = new Uint8Array([4, 5]);
    const at = `${PREFIX}${sha256Hex(whole)}`;
    s3.objects.set(at, whole);
    const cancelled = (await bucket.get(at))!.getReader();
    await cancelled.read();
    await cancelled.cancel();
    expect(cached()).toEqual([]);

    const cut = cachedR2Bucket({
      ...r2Bucket(s3.config),
      get: async () => {
        let sent = false;
        return new ReadableStream({
          pull: (controller) => {
            if (sent) return controller.error(new Error('cut'));
            sent = true;
            controller.enqueue(whole.subarray(0, 1));
          },
        });
      },
    }, dir, 1 << 20);
    await expect(read(cut, at)).rejects.toThrow('cut');
    expect(cached()).toEqual([]);
  });

  it('copies and reads back a picture that arrives in many chunks', async () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, at) => at % 251);
    const at = `${PREFIX}${sha256Hex(bytes)}`;
    dir = mkdtempSync(join(tmpdir(), 'hazelle-'));
    let fetched = 0;
    const bucket = cachedR2Bucket(
      {
        ...r2Bucket(s3.config),
        get: async () => {
          fetched++;
          let sent = 0;
          return new ReadableStream({
            pull: (controller) => {
              if (sent >= bytes.length) return controller.close();
              controller.enqueue(bytes.slice(sent, sent + 30_000));
              sent += 30_000;
            },
          });
        },
      },
      dir,
      1 << 20,
    );
    expect(await read(bucket, at)).toEqual(bytes);
    expect(await read(bucket, at)).toEqual(bytes);
    expect(fetched).toBe(1);
  });

  it('writes a put through to R2 and keeps the copy it reads next', async () => {
    const bucket = fresh();
    const bytes = new Uint8Array([6, 7]);
    const at = `${PREFIX}${sha256Hex(bytes)}`;
    await bucket.put(at, bytes);
    expect(s3.objects.get(at)).toEqual(bytes);
    expect(await read(bucket, at)).toEqual(bytes);
    expect(reads()).toBe(0);
  });

  it('trims what went unused for 3 days, then the least recently used down to 90 % of the cap, and settled temp files', async () => {
    const bucket = fresh(10);
    for (const char of ['a', 'b', 'c', 'd']) await bucket.put(key(char), new Uint8Array(4));
    writeFileSync(join(dir, 'cache', '.tmp-old'), 'x');
    writeFileSync(join(dir, 'cache', '.tmp-new'), 'x');
    used('a'.repeat(64), NOW - 73 * HOUR_MS);
    used('b'.repeat(64), NOW - 2 * HOUR_MS);
    used('c'.repeat(64), NOW - 3 * HOUR_MS);
    used('d'.repeat(64), NOW);
    used('.tmp-old', NOW - 2 * HOUR_MS);
    used('.tmp-new', NOW);
    expect((await bucket.trim(NOW)).sort()).toEqual(['.tmp-old', 'a'.repeat(64), 'c'.repeat(64)].map((name) => `cache/${name}`).sort());
    expect(cached()).toEqual(['.tmp-new', 'b'.repeat(64), 'd'.repeat(64)]);
  });

  it('with a cap of 0 copies nothing and trims what an earlier run copied', async () => {
    const bucket = fresh(0);
    mkdirSync(join(dir, 'cache'));
    writeFileSync(join(dir, 'cache', 'e'.repeat(64)), 'x');
    const bytes = new Uint8Array([8]);
    const at = `${PREFIX}${sha256Hex(bytes)}`;
    await bucket.put(at, bytes);
    await read(bucket, at);
    await read(bucket, at);
    expect(reads()).toBe(2);
    expect(await bucket.trim(NOW)).toEqual([`cache/${'e'.repeat(64)}`]);
    expect(cached()).toEqual([]);
  });
});

it('chooses the disk unless the environment names a whole R2 setting', () => {
  expect(chooseBucket({ HAZELLE_FILES_BUCKET: ' ' }, '/data').kind).toBe('disk');
  expect(() => chooseBucket({ HAZELLE_FILES_BUCKET: 's3' }, '/data')).toThrow(/must be disk or r2/);
  const r2 = { HAZELLE_FILES_BUCKET: 'r2', HAZELLE_FILES_R2_ENDPOINT: 'https://x.r2.cloudflarestorage.com', HAZELLE_FILES_R2_BUCKET: 'b', HAZELLE_FILES_R2_ACCESS_KEY_ID: 'k' };
  expect(() => chooseBucket(r2, '/data')).toThrow(/needs HAZELLE_FILES_R2_SECRET_ACCESS_KEY/);
  expect(chooseBucket({ ...r2, HAZELLE_FILES_R2_SECRET_ACCESS_KEY: 's' }, '/data').kind).toBe('r2');
  expect(() => chooseBucket({ ...r2, HAZELLE_FILES_R2_SECRET_ACCESS_KEY: 's', HAZELLE_FILES_CACHE_BYTES: '20GB' }, '/data')).toThrow(/HAZELLE_FILES_CACHE_BYTES must be a whole number/);
});
