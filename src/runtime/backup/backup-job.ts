import type { ApiFailure, ApiResult } from '../api';
import { exportBackup, readBackup, restoreBackup, type BackupFailure, type BackupPin, type BackupStep, type Options, type ReadArchive, type RestoreStore } from './backup-core';
import type { BackupPeer } from './backup-peer';
import type { BackupRecords } from './backup-records';
import { bufferedBackupOutput } from '../export/backup-zip';
import type { Files } from '../files/files';
import type { ObjectRow, ObjectStore, Pin } from '../store/store';
import type { Write } from '../store/object-writes';

export type ExportStore = Pick<ObjectStore, 'scan' | 'pin' | 'list'>;
export type ExportFiles = Pick<Files, 'read' | 'missing'>;
export type RestoreFiles = Pick<Files, 'save'>;
export type BackupInput =
  | { kind: 'export' }
  | { kind: 'read'; file: Blob }
  | { kind: 'restore'; pin: Pin };
type BackupTask = BackupInput & { id: number };
export type ScanCall = { scan: number; options: Parameters<ObjectStore['scan']>[0]; pin: Pin };
export type ScanRows = { scan: number; rows: { row: ObjectRow; value: unknown }[] };
export type BatchCall = { writes: Write[]; unheld?: boolean };
export type BatchAnswer = { result: ApiResult<null>; count: number };
export type SaveFilesCall = { bytes: Uint8Array<ArrayBuffer>[] };
export type OutputCall = { kind: 'write'; bytes: Uint8Array<ArrayBuffer> } | { kind: 'close' | 'abort' };
export type ReadAnswer = { ok: true } | BackupFailure;

// One worker owns one backup job and its temporary parsed-record session. No decoded archive returns to the host.
export class BackupJobs {
  private backup: ReadArchive | null = null;
  private running: { id: number; abort: AbortController } | null = null;
  private nextScan = 0;
  private readonly visits = new Map<number, Parameters<ObjectStore['scan']>[1]>();

  constructor(private readonly peer: BackupPeer, private readonly records: () => Promise<BackupRecords>) {}

  async handle(name: string, args: unknown): Promise<unknown> {
    if (name === 'run') return this.run(args as BackupTask);
    if (name === 'stop') {
      const running = this.running;
      if (running && running.id === args) running.abort.abort();
      return;
    }
    if (name === 'rows') {
      const { scan, rows } = args as ScanRows;
      const visit = this.visits.get(scan);
      if (!visit) throw new Error('Backup scan ended');
      for (const { row, value } of rows) await visit(row, value);
      return;
    }
    if (name === 'close') {
      await this.backup?.records.close();
      this.backup = null;
      return;
    }
    throw new Error('Unknown backup worker call');
  }

  private async run(task: BackupTask) {
    if (this.running) throw new Error('Backup job is already running');
    const abort = new AbortController();
    this.running = { id: task.id, abort };
    let shown = 0;
    const options: Options = {
      signal: abort.signal,
      progress: (step) => {
        const now = performance.now();
        if (step.done !== 0 && step.done !== step.total && now - shown < 100) return;
        shown = now;
        this.peer.notice('progress', step satisfies BackupStep);
      },
    };
    try {
      if (task.kind === 'read') {
        const read = await readBackup(task.file, this.records, options);
        if (!read.ok) return read;
        this.backup = read.backup;
        return { ok: true } satisfies ReadAnswer;
      }
      const scan: ObjectStore['scan'] = async (options, visit, pin) => {
        const scan = ++this.nextScan;
        this.visits.set(scan, visit);
        try { return await this.peer.call<ApiFailure | null>('scan', { scan, options, pin } satisfies ScanCall); }
        finally { this.visits.delete(scan); }
      };
      if (task.kind === 'export') {
        const store = { scan, pin: () => this.peer.call<ApiResult<Pin>>('pin') };
        const files: ExportFiles = {
          read: (ref) => this.peer.call('readFile', ref),
          missing: (ids) => this.peer.call('missingFiles', ids),
        };
        const output = bufferedBackupOutput({
          write: (bytes) => this.peer.call('output', { kind: 'write', bytes } satisfies OutputCall),
          close: () => this.peer.call('output', { kind: 'close' } satisfies OutputCall),
          abort: () => this.peer.call('output', { kind: 'abort' } satisfies OutputCall),
        }, abort.signal);
        return await exportBackup(store, files, output, () => this.peer.call<ApiResult<BackupPin>>('prepare'), options);
      }
      if (!this.backup) throw new Error('No validated backup');
      const store: RestoreStore = {
        scan,
        pinned: (run) => run(task.pin),
        saveSummaries: (chats) => this.peer.call('saveSummaries', chats),
        batch: async (writes, progress, batchOptions) => {
          const { result, count } = await this.peer.call<BatchAnswer>('batch', { writes, unheld: batchOptions?.unheld } satisfies BatchCall);
          for (let index = 0; index < count; index++) progress?.(writes[index]!);
          return result;
        },
      };
      const files: RestoreFiles = { save: (bytes) => this.peer.call('saveFiles', { bytes } satisfies SaveFilesCall) };
      return await restoreBackup(store, files, this.backup, options);
    } finally {
      this.running = null;
    }
  }
}
