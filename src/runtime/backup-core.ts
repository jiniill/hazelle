import { strFromU8, strToU8 } from 'fflate';
import { isRecord } from '../connectors/values';
import { KINDS, parentKinds, type Kind, type Stored } from '../model/kinds';
import { ORDER_ID } from '../model/order';
import { SETTINGS_ID } from '../model/settings';
import type { ApiFailure, ApiResult } from './api';
import { toBase64 } from '../vault/aead';
import type { FileRef } from '../vault/files';
import { BackupZip, indexZip, readEntry, unzipEntry, type BackupOutput, type ZipEntry } from './backup-zip';
import { inOrder, type Files } from './files';
import { BACKUP_PAGE_BYTES as PAGE_BYTES, BACKUP_PAGE_ROWS as PAGE_ROWS, BackupStorageError, type BackupRecord, type BackupRecords } from './backup-records';
import { FIRST_ID } from './personas';
import { FIRST_PROFILE_ID } from './profiles';
import { DEFAULT_PROMPT_IDS } from './prompts';
import { ownershipDepth } from './removal';
import { readRow } from './upgrade';
import type { ObjectRow, ObjectStore, Pin } from './store';
import type { Write } from './object-writes';

// Only this format version is accepted. Evolve stored shapes through runtime/upgrade.ts, never a version bump
// that makes v3 or later exports unreadable (user ruling 2026-10-10).
const FORMAT = { format: 'risu-alpha-backup', version: 3 };
const MANIFEST = 'manifest.json';
const OBJECTS = 'objects.jsonl';
const FILES = 'files/';
const HELD_BYTES = 8 * 1024 * 1024;
// Pictures a restore hands the page in one save, each asking the server once which it lacks; how many go up at once is
// runtime/files'.
const PICTURE_ROWS = 12;
// Saves a restore runs ahead, enough to keep the transfer slots full: each is held three times over (here, cloned to the
// page, sealed there).
const RESTORE_AHEAD = 4;

export const SEEDED: ReadonlySet<string> = new Set([...DEFAULT_PROMPT_IDS, FIRST_ID, FIRST_PROFILE_ID, SETTINGS_ID, ORDER_ID]);

const fileOf = ({ kind, value }: Stored<Kind>): FileRef | null => ('file' in KINDS[kind] ? (value as { file: FileRef }).file : null);

export type BackupStep = { kind: 'objects' | 'files' | 'summaries'; done: number; total: number };
export type Options = { signal?: AbortSignal; progress?: (step: BackupStep) => void };
export type ReadArchive = { file: Blob; entries: Map<string, ZipEntry>; objects: ObjectRow[]; files: Map<string, FileRef>; records: BackupRecords };
export type BackupFailure = { ok: false; error: 'not-backup' | 'other-version' | 'stopped' | 'backup-storage' | 'backup-crashed' };
export type BackupPin = { pin: Pin; excluded: Set<string> };

// Keep connection keys; exclude binned objects, their descendants and unreachable import remnants.
// left counts unreadable objects; skipped counts objects naming blocked pictures. Both scans must share one timeline;
// a restore between them aborts the export rather than producing a mixed archive.
export async function exportBackup(
  store: Pick<ObjectStore, 'scan' | 'pin'>,
  files: Pick<Files, 'read' | 'missing'>,
  output: BackupOutput,
  prepare: (signal: AbortSignal) => Promise<ApiResult<BackupPin>>,
  { signal = new AbortController().signal, progress = () => {} }: Options = {},
): Promise<ApiResult<{ left: number; skipped: number }>> {
  let complete = false;
  let refused: ApiFailure | null = null;
  try {
    const pinned = await prepare(signal);
    if (!pinned.ok) return pinned;
    const { pin, excluded: deleted } = pinned.data;
    const metadata = new Map<string, ObjectRow>();
    const scanned = await store.scan({ metadata: true }, (row) => {
      signal.throwIfAborted();
      metadata.set(row.id, row);
    }, pin);
    if (scanned) return scanned;
    const reached = new Set<string>();
    const total = { objects: 0, files: 0 };
    for (const row of metadata.values()) {
      if (!Object.hasOwn(KINDS, row.kind) || deleted.has(row.id) || (row.parent !== null && deleted.has(row.parent))) continue;
      const kind = row.kind as Kind;
      const owners = parentKinds(kind);
      if (owners.length > 0 && (row.parent === null || !owners.some((owner) => owner === metadata.get(row.parent!)?.kind))) continue;
      reached.add(row.id);
      total.objects++;
      if ('file' in KINDS[kind]) total.files++;
    }
    metadata.clear();
    const done = { objects: 0, files: 0 };
    let left = 0;
    const landed = (kind: 'objects' | 'files', by = 1) => progress({ kind, done: done[kind] += by, total: total[kind] });
    progress({ kind: 'objects', done: 0, total: total.objects });
    progress({ kind: 'files', done: 0, total: total.files });
    const zip = new BackupZip(output, signal);
    const manifest = await zip.entry(MANIFEST, false);
    await manifest(strToU8(JSON.stringify(FORMAT)), true);
    const objects = await zip.entry(OBJECTS, true);
    const named = new Map<string, { ref: FileRef; size: number; uses: number }>();
    const blocked = new Set<string>();
    let skipped = 0;
    let first = true;
    // Discover blocked files before emitting any row that names them: readBackup rejects missing archive files.
    // Hold rows from the first unknown picture; batch existence checks and read only server-missing files early.
    let held: { line: string; ref: FileRef | null; size: number }[] = [];
    let heldBytes = 0;
    const unasked = new Map<string, FileRef>();
    const settle = async () => {
      if (unasked.size) {
        const missing = await files.missing([...unasked.keys()]);
        if (!missing.ok) throw (refused = missing);
        for (const id of missing.data.missing) {
          const read = await files.read(unasked.get(id)!);
          if (!read.ok && read.error !== 'file-blocked') throw (refused = read);
          if (!read.ok) blocked.add(id);
        }
        unasked.clear();
      }
      for (const { line, ref, size } of held) {
        signal.throwIfAborted();
        if (ref && blocked.has(ref.id)) {
          skipped++;
          landed('objects');
          landed('files');
          continue;
        }
        if (ref) named.set(ref.id, { ref, size, uses: (named.get(ref.id)?.uses ?? 0) + 1 });
        await objects(strToU8(`${first ? '' : '\n'}${line}`));
        first = false;
        landed('objects');
      }
      held = [];
      heldBytes = 0;
    };
    // Concurrent edits may repeat an id later in the walk. Keep its first row: the importer rejects duplicate ids.
    const failure = await store.scan({}, async (row, value) => {
      signal.throwIfAborted();
      const due = reached.delete(row.id);
      if (value === undefined || !Object.hasOwn(KINDS, row.kind)) {
        left++;
        if (due) {
          landed('objects');
          if ('file' in KINDS[row.kind as Kind]) landed('files');
        }
        return;
      }
      if (!due) return;
      const object = { ...row, kind: row.kind as Kind, value } as Stored<Kind>;
      const ref = fileOf(object);
      if (ref && !named.has(ref.id) && !blocked.has(ref.id)) unasked.set(ref.id, ref);
      const line = JSON.stringify(object);
      held.push({ line, ref, size: ref ? (value as { size: number }).size : 0 });
      heldBytes += line.length;
      if (!unasked.size || heldBytes > HELD_BYTES) await settle();
    }, pin);
    if (failure) return failure;
    await settle();
    await objects(new Uint8Array(), true);
    // Written in order, as a zip is sequential, while the next ones are read.
    for await (const [{ ref, uses }, bytes] of inOrder([...named.values()], ({ ref }) => files.read(ref, { signal }), { size: ({ size }) => size })) {
      signal.throwIfAborted();
      if (!bytes.ok) return bytes;
      // Pictures are compressed already.
      const push = await zip.entry(FILES + ref.id, false);
      await push(bytes.data, true);
      landed('files', uses);
    }
    // The pictures are read after the scans, with no timeline of their own: a restore heard meanwhile fails the export
    // as one between the scans does.
    const still = await store.pin(signal);
    if (!still.ok) return still;
    await zip.end();
    signal.throwIfAborted();
    await output.close();
    complete = true;
    return { ok: true, data: { left, skipped } };
  } catch {
    return refused ?? { ok: false, error: signal.aborted ? 'stopped' : 'backup-write' };
  } finally {
    if (!complete) await output.abort();
  }
}

// Validate every external row/body before any restore write; one bad line rejects the file.
// Keep only references/metadata here; encrypted staging holds validated pages without reinflating per ownership depth.
export async function readBackup(file: Blob, createRecords: () => Promise<BackupRecords>, { signal = new AbortController().signal, progress = () => {} }: Options = {}): Promise<{ ok: true; backup: ReadArchive } | BackupFailure> {
  let records: BackupRecords | null = null;
  let complete = false;
  try {
    const entries = await indexZip(file, signal);
    const manifestEntry = entries.get(MANIFEST);
    if (!manifestEntry || manifestEntry.size > 16384) return { ok: false, error: 'not-backup' };
    const manifest = parse(strFromU8(await readEntry(file, manifestEntry, signal)));
    if (!isRecord(manifest) || manifest.format !== FORMAT.format) return { ok: false, error: 'not-backup' };
    if (manifest.version !== FORMAT.version) return { ok: false, error: 'other-version' };
    records = await createRecords();
    const backup: ReadArchive = { file, entries, objects: [], files: new Map(), records };
    let page: BackupRecord[] = [];
    let bytes = 0;
    const flush = async () => {
      await records!.write(page, signal);
      page = [];
      bytes = 0;
    };
    const ids = new Set<string>();
    let rev = -Infinity;
    for await (const item of readObjects(backup, signal)) {
      const { object } = item;
      // Both exporters walk the server's revision-ordered scan. Stage that order within each ownership depth,
      // including equal revisions, so entries keep their fold order and owners can still be written last.
      if (object.rev < rev || ids.has(object.id)) return { ok: false, error: 'not-backup' };
      rev = object.rev;
      ids.add(object.id);
      const { id, kind, parent, rev: revision } = object;
      backup.objects.push({ id, kind, parent, rev: revision });
      if (page.length && (page.length === PAGE_ROWS || bytes + item.size > PAGE_BYTES)) await flush();
      page.push(item);
      bytes += item.size;
      const ref = fileOf(object);
      if (ref) {
        if (!entries.has(FILES + ref.id) || (backup.files.has(ref.id) && backup.files.get(ref.id)!.key !== ref.key)) return { ok: false, error: 'not-backup' };
        backup.files.set(ref.id, ref);
      }
    }
    if (page.length) await flush();
    progress({ kind: 'objects', done: 0, total: backup.objects.filter(({ kind }) => kind !== 'summary').length });
    progress({ kind: 'files', done: 0, total: backup.files.size });
    complete = true;
    return { ok: true, backup };
  } catch (error) {
    return { ok: false, error: signal.aborted ? 'stopped' : error instanceof BackupStorageError ? 'backup-storage' : 'not-backup' };
  } finally {
    if (!complete) await records?.close().catch(() => {});
  }
}

async function* readObjects(backup: ReadArchive, signal: AbortSignal) {
  const entry = backup.entries.get(OBJECTS);
  if (!entry) throw new Error('Missing objects');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  const line = (text: string) => {
    const object = readRow(parse(text));
    if (!object) throw new Error('Bad object');
    return { object, size: text.length * 2 };
  };
  for await (const bytes of unzipEntry(backup.file, entry, signal)) {
    text += decoder.decode(bytes, { stream: true });
    let at = 0;
    let end: number;
    while ((end = text.indexOf('\n', at)) !== -1) {
      signal.throwIfAborted();
      yield line(text.slice(at, end));
      at = end + 1;
    }
    text = text.slice(at);
  }
  text += decoder.decode();
  if (text) yield line(text);
}

// Restore only into a fresh account or this exact backup's partial restore, replacing/removing starter defaults.
// Check and write on one timeline. Skip/count refused-picture objects; host saveSummaries updates derived summaries.
export type RestoreStore = Pick<ObjectStore, 'scan' | 'batch' | 'pinned'> & { saveSummaries: (chats: string[], signal: AbortSignal, progress: (step: BackupStep) => void) => Promise<ApiFailure | null> };

export function restoreBackup(store: RestoreStore, files: Pick<Files, 'save'>, backup: ReadArchive, options: Options = {}): Promise<ApiResult<{ skipped: number }>> {
  return store.pinned((pin) => restoreOn(store, files, backup, options, pin), options.signal);
}

async function restoreOn(
  store: Omit<RestoreStore, 'pinned'>,
  files: Pick<Files, 'save'>,
  backup: ReadArchive,
  { signal = new AbortController().signal, progress = () => {} }: Options,
  pin: Pin,
): Promise<ApiResult<{ skipped: number }>> {
  try {
    const ids = new Set(backup.objects.filter(({ kind }) => kind !== 'summary').map(({ id }) => id));
    const present = new Set<string>();
    const failure = await store.scan({ metadata: true }, (row) => {
      signal.throwIfAborted();
      if (row.kind !== 'summary') present.add(row.id);
    }, pin);
    if (failure) return failure;
    if ([...present].some((id) => !ids.has(id) && !SEEDED.has(id))) return { ok: false, error: 'not-new' };
    // Shared ids do not prove a resumable restore: non-starter content must equal this backup's earlier copies.
    // Do not rewrite matching starter rows: new revs would stale summaries already restored.
    const held = new Set([...present].filter((id) => ids.has(id)));
    const same = new Set<string>();
    if (held.size) {
      const copies = new Map<string, string>();
      for (const depth of depthsOf(backup, held)) {
        for await (const { object } of backup.records.read(depth, held, signal)) copies.set(object.id, await copyOf(object));
      }
      let other = false;
      const failure = await store.scan({}, async (row, value) => {
        signal.throwIfAborted();
        if (!copies.has(row.id)) return;
        if (copies.get(row.id) === (await copyOf({ ...row, value }))) same.add(row.id);
        else if (!SEEDED.has(row.id)) other = true;
      }, pin);
      if (failure) return failure;
      if (other) return { ok: false, error: 'not-new' };
    }
    const todo = new Set([...ids].filter((id) => !same.has(id)));
    const total = { objects: todo.size, files: backup.files.size };
    const done = { objects: 0, files: 0 };
    const landed = (kind: 'objects' | 'files') => progress({ kind, done: ++done[kind], total: total[kind] });
    progress({ kind: 'objects', done: 0, total: total.objects });
    progress({ kind: 'files', done: 0, total: total.files });
    // Verify every file seals to its referenced id and opens with its object's key before writing any objects.
    // Hash equality alone cannot detect an independently altered key; server-held files need no reupload.
    const refused = new Set<string>();
    // A chunk never holds another picture beside one past the bytes: that file cannot be cut.
    const chunks: { ref: FileRef; entry: ZipEntry }[][] = [];
    let chunk: { ref: FileRef; entry: ZipEntry }[] = [];
    let chunkBytes = 0;
    for (const ref of backup.files.values()) {
      const entry = backup.entries.get(FILES + ref.id)!;
      if (chunk.length && (chunk.length === PICTURE_ROWS || chunkBytes + entry.size > HELD_BYTES)) {
        chunks.push(chunk);
        chunk = [];
        chunkBytes = 0;
      }
      chunk.push({ ref, entry });
      chunkBytes += entry.size;
    }
    if (chunk.length) chunks.push(chunk);
    const saveChunk = async (chunk: { entry: ZipEntry }[]) => {
      const read = await Promise.all(chunk.map(({ entry }) => readEntry(backup.file, entry, signal).catch(() => null)));
      if (read.some((bytes) => !bytes)) return null;
      return files.save(read as Uint8Array<ArrayBuffer>[], { signal });
    };
    const sizeOf = (chunk: { entry: ZipEntry }[]) => chunk.reduce((sum, { entry }) => sum + entry.size, 0);
    for await (const [chunk, saved] of inOrder(chunks, saveChunk, { ahead: RESTORE_AHEAD, size: sizeOf })) {
      signal.throwIfAborted();
      if (!saved) return { ok: false, error: 'not-backup' };
      if (!saved.ok) return saved;
      for (const [index, { ref }] of chunk.entries()) {
        const sealed = saved.data[index];
        if (!sealed) refused.add(ref.id);
        else if (sealed.id !== ref.id || sealed.key !== ref.key) return { ok: false, error: 'not-backup' };
        landed('files');
      }
    }
    let skipped = 0;
    // In their old rev order, so each chat's entries fold as they did; owners follow every owned page.
    const depths = depthsOf(backup, todo);
    for (const depth of depths) {
      let writes: Write[] = [];
      let size = 0;
      const flush = async () => {
        const result = await store.batch(writes, () => landed('objects'), { unheld: true, signal });
        writes = [];
        size = 0;
        return result;
      };
      for await (const item of backup.records.read(depth, todo, signal)) {
        const file = fileOf(item.object);
        if (file && refused.has(file.id)) {
          skipped++;
          landed('objects');
          continue;
        }
        if (writes.length && (writes.length === PAGE_ROWS || size + item.size > PAGE_BYTES)) {
          const result = await flush();
          if (!result.ok) return result;
        }
        writes.push({ ...item.object, type: 'restore' });
        size += item.size;
      }
      if (writes.length) {
        const result = await flush();
        if (!result.ok) return result;
      }
    }
    const removed = await store.batch([...SEEDED].filter((id) => !ids.has(id) && present.has(id)).map((id) => ({ type: 'remove', id })), undefined, { signal });
    if (!removed.ok) return removed;
    // Resume includes already-written roots: an interruption may have left their derived summaries unfinished.
    const summarized = await store.saveSummaries(backup.objects.filter(({ kind }) => kind === 'chat').map(({ id }) => id), signal, progress);
    return summarized ?? { ok: true, data: { skipped } };
  } catch (error) {
    // A picture entry that does not read refuses the file above; what throws here is the stage, the host or the worker.
    return { ok: false, error: signal.aborted ? 'stopped' : error instanceof BackupStorageError ? 'backup-storage' : 'backup-crashed' };
  }
}

function depthsOf(backup: ReadArchive, wanted: ReadonlySet<string>): number[] {
  return [...new Set(backup.objects.filter(({ id }) => wanted.has(id)).map(({ kind }) => ownershipDepth(kind as Kind)))].sort((a, b) => b - a);
}

async function copyOf({ kind, parent, value }: { kind: string; parent: string | null; value: unknown }): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', strToU8(JSON.stringify([kind, parent, value])));
  return toBase64(new Uint8Array(digest));
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
