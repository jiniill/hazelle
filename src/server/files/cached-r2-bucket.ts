import { createHash, randomBytes } from 'node:crypto';
import type { Stats } from 'node:fs';
import { mkdir, open, rename, rm, stat, utimes, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { checkedKey, type R2Bucket } from './bucket';
import { entries } from './disk-bucket';

// Cache files/ pictures only at cache/<sha256>, shared across account copies; never snapshot archives.
// This sits BELOW access control: callers must check account_files and blocks before serving any cached body.
// Never use a hit to prove a store key exists. Verify hash before rename from .tmp-*; no fsync is needed:
// crash loss is only a cache miss, never a named torn entry.

// Outside everything a backup generation captures and a restore writes (backup/generation.ts, restore.ts).
const CACHE_DIR = 'cache';
const ID = /^[0-9a-f]{64}$/;
// An entry unused this long goes: the privacy page promises a deleted account's pictures are gone within 7 days, and no
// read touches one after its rows are gone.
const IDLE_MS = 3 * 24 * 60 * 60 * 1000;
// A .tmp-* this old is a fill a crash cut off: a running one writes, and so touches it, chunk by chunk.
const SETTLE_MS = 60 * 60 * 1000;
// Over the cap, entries go oldest-used first until this share of it is left.
const LOW_WATER = 0.9;
const CHUNK = 64 * 1024;

async function statOf(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function cachedR2Bucket(store: R2Bucket, dataDir: string, capBytes: number): R2Bucket {
  const dir = join(dataDir, CACHE_DIR);
  const idOf = (key: string) => checkedKey(key).slice(-64);
  const temp = () => join(dir, `.tmp-${randomBytes(8).toString('hex')}`);

  // Touched only once the whole picture was read: a read the route refused cancels at once, and must not keep a deleted
  // account's picture past the idle limit.
  const hit = async (id: string): Promise<ReadableStream<Uint8Array> | null> => {
    const path = join(dir, id);
    let file: FileHandle;
    try {
      file = await open(path, 'r');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const chunk = new Uint8Array(CHUNK);
          const { bytesRead } = await file.read(chunk, 0, CHUNK, null).catch(async (error: unknown) => {
            await file.close();
            throw error;
          });
          if (bytesRead > 0) return controller.enqueue(chunk.subarray(0, bytesRead));
          await file.close();
          const now = new Date();
          // An entry trimmed since it was opened has nothing to touch.
          await utimes(path, now, now).catch(() => {});
          controller.close();
        },
        cancel: () => file.close(),
      },
      // Nothing is read ahead of the reader, so a cancelled read never reaches the end.
      { highWaterMark: 0 },
    );
  };

  // Stream to the reader without waiting for disk; publish cache only after complete hash verification.
  // Disk failures drop the copy, not the read; trim owns abandoned .tmp-* cleanup.
  const fill = async (id: string, body: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>> => {
    const reader = body.getReader();
    const hash = createHash('sha256');
    const path = temp();
    let copy: FileHandle | null = await mkdir(dir, { recursive: true }).then(() => open(path, 'wx')).catch(() => null);
    const drop = async () => {
      if (!copy) return;
      const file = copy;
      copy = null;
      await file.close().catch(() => {});
      await rm(path, { force: true }).catch(() => {});
    };
    const keep = async () => {
      if (!copy) return;
      if (hash.digest('hex') !== id) return drop();
      const file = copy;
      copy = null;
      await file.close();
      await rename(path, join(dir, id));
    };
    return new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const chunk = await reader.read().catch(async (error: unknown) => {
            await drop();
            throw error;
          });
          if (chunk.done) {
            await keep().catch(() => rm(path, { force: true }).catch(() => {}));
            controller.close();
            return;
          }
          if (copy) {
            hash.update(chunk.value);
            await copy.writeFile(chunk.value).catch(drop);
          }
          controller.enqueue(chunk.value);
        },
        async cancel(reason) {
          await drop();
          await reader.cancel(reason);
        },
      },
      { highWaterMark: 0 },
    );
  };

  // The bytes were checked against the id by every caller (files.ts publish, a restore's verify) before the store took
  // them. A copy that cannot be written is only a later miss: the store holds the picture.
  const place = async (id: string, body: Uint8Array) => {
    const path = temp();
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(path, body, { flag: 'wx' });
      await rename(path, join(dir, id));
    } catch {
      await rm(path, { force: true }).catch(() => {});
    }
  };

  const trim = async (now: number): Promise<string[]> => {
    const removed: string[] = [];
    const remove = async (name: string) => {
      await rm(join(dir, name), { force: true });
      removed.push(`${CACHE_DIR}/${name}`);
    };
    const kept: { name: string; size: number; used: number }[] = [];
    for (const name of await entries(dir)) {
      const at = await statOf(join(dir, name));
      if (at === null) continue;
      if (name.startsWith('.tmp-')) {
        if (at.mtimeMs < now - SETTLE_MS) await remove(name);
      } else if (ID.test(name)) {
        if (at.mtimeMs < now - IDLE_MS) await remove(name);
        else kept.push({ name, size: at.size, used: at.mtimeMs });
      }
    }
    let total = kept.reduce((sum, { size }) => sum + size, 0);
    if (total > capBytes) {
      for (const { name, size } of kept.sort((a, b) => a.used - b.used)) {
        if (total <= capBytes * LOW_WATER) break;
        await remove(name);
        total -= size;
      }
    }
    return removed;
  };

  if (capBytes === 0) return { ...store, trim };
  return {
    ...store,
    get: async (key) => {
      if (checkedKey(key).startsWith('snapshots/')) return store.get(key);
      const id = idOf(key);
      const cached = await hit(id);
      if (cached) return cached;
      const body = await store.get(key);
      return body && fill(id, body);
    },
    put: async (key, body) => {
      if (checkedKey(key).startsWith('snapshots/')) return store.put(key, body);
      const id = idOf(key);
      await store.put(key, body);
      await place(id, body instanceof Uint8Array ? body : new Uint8Array(body));
    },
    trim,
  };
}
