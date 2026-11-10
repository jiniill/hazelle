// Production imports backup.ts and always uses its worker and disk-backed encrypted stage; tests inject this in-memory
// stage explicitly instead of installing a browser/worker-detection fallback.
import { pinBackup } from '../backup/backup';
import { exportBackup as exportCore, readBackup as readCore, restoreBackup as restoreCore, type Options, type ReadArchive } from '../backup/backup-core';
import type { ExportFiles, ExportStore } from '../backup/backup-job';
import { byDepth, type BackupRecord, type BackupRecords } from '../backup/backup-records';
import type { BackupOutput } from '../export/backup-zip';
import type { Files } from '../files/files';
import type { ObjectStore } from '../store/store';
import { saveSummaries } from '../store/summary';

export type { BackupOutput } from '../export/backup-zip';

class MemoryBackupRecords implements BackupRecords {
  private readonly depths = new Map<number, BackupRecord[]>();
  async write(records: BackupRecord[], signal: AbortSignal) {
    signal.throwIfAborted();
    for (const [depth, page] of byDepth(structuredClone(records))) {
      const kept = this.depths.get(depth);
      if (kept) kept.push(...page);
      else this.depths.set(depth, page);
    }
  }
  async *read(depth: number, wanted: ReadonlySet<string>, signal: AbortSignal) {
    for (const record of this.depths.get(depth) ?? []) {
      signal.throwIfAborted();
      if (wanted.has(record.object.id)) yield structuredClone(record);
    }
  }
  async close() { this.depths.clear(); }
}

export const exportBackup = (store: ExportStore, files: ExportFiles, output: BackupOutput, options: Options = {}) =>
  exportCore(store, files, output, (signal) => pinBackup(store, signal), options);
export const readBackup = (file: Blob, options: Options = {}) => readCore(file, async () => new MemoryBackupRecords(), options);
// As runtime/backup/backup's host serves the worker: the summary pass runs on the store itself.
export const restoreBackup = (store: ObjectStore, files: Pick<Files, 'save'>, backup: ReadArchive, options: Options = {}) =>
  restoreCore({ scan: store.scan.bind(store), batch: store.batch.bind(store), pinned: store.pinned.bind(store), saveSummaries: (chats, signal, progress) => saveSummaries(store, chats, signal, (done, total) => progress({ kind: 'summaries', done, total })) }, files, backup, options);
