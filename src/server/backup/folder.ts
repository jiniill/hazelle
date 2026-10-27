import { existsSync } from 'node:fs';
import { access, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fsyncPath, makeDirs } from '../db/durable';
import { DEPARTURES } from './departures';
import { COPIED, copyWhole, generationsDir, listGenerations, MANIFEST, POOL, thinGenerations } from './generation';
import { pass } from './snapshots';

// Use the copier's backup/ layout so restore.ts reads it unchanged. Disk-store, non-container installs only:
// R2 archives are not fetched here, and container paths disappear on replacement.
// Copy departures, then each unmarked generation's pool/files/manifest, then both copied markers; prune last.
// Content-addressed files appear only whole, so interrupted passes resume without rereading completed files.
export async function copyToFolder(dataDir: string, folder: string, now: number): Promise<{ copied: string[] }> {
  const local = generationsDir(dataDir);
  // No pool yet: the first generation has not begun.
  if (!existsSync(join(local, POOL))) return { copied: [] };
  // Never made here: a drive or card gone, a mount point left empty, would take the copies onto this disk unnoticed.
  await access(folder);
  if (existsSync(join(local, DEPARTURES))) await copyWhole(join(local, DEPARTURES), join(folder, DEPARTURES));
  const pending = (await listGenerations(dataDir)).filter(({ id }) => existsSync(join(local, id, MANIFEST)) && !existsSync(join(local, id, COPIED)));
  if (pending.length) await copyTree(join(local, POOL), join(folder, POOL));
  for (const { id } of pending) {
    await copyTree(join(local, id), join(folder, id), new Set([MANIFEST, COPIED]));
    await copyWhole(join(local, id, MANIFEST), join(folder, id, MANIFEST));
    const at = `${new Date(now).toISOString()}\n`;
    await writeFile(join(folder, id, COPIED), at);
    fsyncPath(join(folder, id));
    await writeFile(join(local, id, COPIED), at);
  }
  fsyncPath(folder);
  await thinGenerations(folder, now);
  return { copied: pending.map(({ id }) => id) };
}

async function copyTree(from: string, to: string, skip = new Set<string>()) {
  makeDirs(to);
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.tmp-')) continue;
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else if (!existsSync(target)) await copyWhole(source, target);
    await pass();
  }
  fsyncPath(to);
}

// Accept Explorer's quoted copy-path form. Probe writability before saving, never accept an unusable folder.
export async function checkFolder(dataDir: string, typed: string): Promise<{ ok: true; folder: string } | { ok: false; error: 'folder-not-absolute' | 'folder-in-data' | 'folder-unwritable' }> {
  const unquoted = typed.trim().replace(/^"(.*)"$/, '$1');
  if (!isAbsolute(unquoted)) return { ok: false, error: 'folder-not-absolute' };
  const folder = resolve(unquoted);
  const data = resolve(dataDir);
  const within = (child: string, parent: string) => !relative(parent, child).startsWith('..') && !isAbsolute(relative(parent, child));
  if (within(folder, data) || within(data, folder)) return { ok: false, error: 'folder-in-data' };
  const probe = join(folder, `.tmp-${Date.now()}`);
  try {
    makeDirs(folder);
    await writeFile(probe, '');
    await rm(probe);
  } catch {
    return { ok: false, error: 'folder-unwritable' };
  }
  return { ok: true, folder };
}
