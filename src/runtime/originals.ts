import type { Part } from '../engine/import/original';
import type { Original } from '../model/library';
import type { ApiResult } from './api';
import type { Progress } from './characters';
import { saveEach, type Files } from './files';
import type { Write } from './object-writes';
import type { ObjectStore } from './store';

// name: the file's own, which says how it is read again.
export type OriginalFile = { name: string; parts: Part[] };

// Kept once its owner is saved (docs/roadmap/import-originals.md), as rows that go with the owner to 휴지통 and out
// for good. A piece that cannot be read is left out, as the import read it as missing too; unkept: those the server
// refused.
export async function keepOriginal(store: ObjectStore, files: Files, parent: string, { name, parts }: OriginalFile, progress: Progress): Promise<ApiResult<{ unkept: number }>> {
  const saved = await saveEach(files, parts, ({ path }, bytes) => (bytes ? path : null), (done) => progress({ kind: 'original', done, total: parts.length }));
  if (!saved.ok) return saved;
  const pieces = saved.data.flatMap(({ value: path, size, file }): Original[] => (file ? [{ name, path, size, file }] : []));
  if (pieces.length) {
    const written = await store.batch(pieces.map((value): Write => ({ type: 'create', kind: 'original', id: crypto.randomUUID(), parent, value })));
    if (!written.ok) return written;
  }
  return { ok: true, data: { unkept: saved.data.length - pieces.length } };
}
