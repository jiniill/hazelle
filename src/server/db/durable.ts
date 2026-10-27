import { createHash } from 'node:crypto';
import { closeSync, createReadStream, existsSync, fsyncSync, mkdirSync, openSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Shared durability boundary: sync files before catalog rows/manifests name them; verify against recorded hashes/sizes.

// Windows flushes a file only through a handle open for writing and refuses to flush a directory (EPERM); NTFS journals
// a rename itself, so there a directory's sync is skipped. Elsewhere a read handle flushes either.
function flushMode(path: string): 'r' | 'r+' | null {
  if (process.platform !== 'win32') return 'r';
  return statSync(path).isDirectory() ? null : 'r+';
}

export function fsyncPath(path: string): void {
  const mode = flushMode(path);
  if (mode === null) return;
  const fd = openSync(path, mode);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export async function syncPath(path: string): Promise<void> {
  const mode = flushMode(path);
  if (mode === null) return;
  const handle = await open(path, mode);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// Sync each newly created directory into its parent; caller syncs entries it adds afterward.
// Find missing paths before mkdir: Windows returns \?\ paths that relative() cannot compare.
export function makeDirs(dir: string): void {
  const made: string[] = [];
  for (let path = resolve(dir); !existsSync(path); path = dirname(path)) made.unshift(path);
  if (made.length === 0) return;
  mkdirSync(dir, { recursive: true });
  for (const path of made) fsyncPath(dirname(path));
}

export async function digest(source: string | ReadableStream<Uint8Array>): Promise<{ sha256: string; bytes: number }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of (typeof source === 'string' ? createReadStream(source) : source) as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}
