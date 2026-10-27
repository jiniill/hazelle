import { REMOVABLE } from '../model/library';
import type { ApiResult } from './api';
import type { BackupFailure, BackupPin, BackupStep, Options } from './backup-core';
import type { BackupInput, BatchAnswer, BatchCall, ExportFiles, ExportStore, OutputCall, ReadAnswer, RestoreFiles, SaveFilesCall, ScanCall, ScanRows } from './backup-job';
import { BackupPeer, type BackupMessage } from './backup-peer';
import type { BackupOutput } from './backup-zip';
import type { ObjectStore } from './store';
import { saveSummaries } from './summary';
import { moduleWorker } from './worker';
import type { FileRef } from '../vault/files';
import workerUrl from './backup-worker?worker&url';

export type { BackupOutput } from './backup-zip';
export type { BackupStep } from './backup-core';
export type Backup = { close: () => Promise<void>; worker: BackupWorker };

type Host = { store: ExportStore; files: ExportFiles; output: BackupOutput } | { store: ObjectStore; files: RestoreFiles };

// Deletion/character links are sealed: send only their ids, never full library values, to the worker.
// Capture after pin settles so fresh/rewound stores and metadata share one timeline.
export async function pinBackup(store: Pick<ObjectStore, 'pin' | 'list'>, signal?: AbortSignal): Promise<ApiResult<BackupPin>> {
  const pinned = await store.pin(signal);
  if (!pinned.ok) return pinned;
  const excluded = new Set(REMOVABLE.flatMap((kind) => store.list(kind).filter(({ value }) => value.deleted !== undefined).map(({ id }) => id)));
  for (const { id, value } of store.list('chat')) if (value.character !== null && excluded.has(value.character)) excluded.add(id);
  return { ok: true, data: { pin: pinned.data, excluded } };
}

class BackupWorker {
  private readonly worker = moduleWorker(workerUrl);
  private readonly peer = new BackupPeer((message) => this.worker.postMessage(message), (name, args) => this.handle(name, args));
  private next = 0;
  private host: Host | null = null;
  private options: Options = {};
  private active: Promise<unknown> | null = null;
  private stop: (() => void) | null = null;
  private closed = false;

  constructor() {
    this.worker.onmessage = ({ data }: MessageEvent<BackupMessage>) => this.peer.receive(data);
    this.worker.onerror = () => this.peer.close();
  }

  async run<T>(task: BackupInput, host: Host | null, options: Options): Promise<T> {
    options.signal?.throwIfAborted();
    this.host = host;
    this.options = options;
    const id = ++this.next;
    const stop = () => this.peer.notice('stop', id);
    this.stop = stop;
    options.signal?.addEventListener('abort', stop, { once: true });
    const running = this.peer.call<T>('run', { ...task, id });
    this.active = running;
    try { return await running; }
    finally {
      options.signal?.removeEventListener('abort', stop);
      this.stop = null;
      this.active = null;
      this.host = null;
      this.options = {};
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.stop?.();
    await this.active?.catch(() => {});
    // A crash leaves only encrypted stage rows, reclaimed by the next worker. Cleanup must not hide a restore's result.
    try { await this.peer.call('close'); } catch { /* The worker may already have failed. */ }
    finally { this.peer.close(); this.worker.terminate(); }
  }

  private async handle(name: string, args: unknown): Promise<unknown> {
    if (name === 'progress') {
      this.options.progress?.(args as BackupStep);
      return;
    }
    const host = this.host;
    if (!host) throw new Error('Backup host ended');
    const signal = this.options.signal;
    if (name === 'scan') {
      const { scan, options, pin } = args as ScanCall;
      let rows: ScanRows['rows'] = [];
      const flush = async () => {
        await this.peer.call('rows', { scan, rows } satisfies ScanRows);
        rows = [];
      };
      const failure = await host.store.scan(options, async (row, value) => {
        signal?.throwIfAborted();
        rows.push({ row, value });
        if (rows.length === 64) await flush();
      }, pin);
      if (!failure && rows.length) await flush();
      return failure;
    }
    if ('output' in host) {
      if (name === 'prepare') return pinBackup(host.store, signal);
      if (name === 'pin') return host.store.pin(signal);
      if (name === 'readFile') return host.files.read(args as FileRef, { signal, bulk: true });
      if (name === 'missingFiles') return host.files.missing(args as string[]);
      if (name === 'output') {
        const output = args as OutputCall;
        if (output.kind === 'write') return host.output.write(output.bytes);
        if (output.kind === 'close') return host.output.close();
        return host.output.abort();
      }
    } else {
      if (name === 'batch') {
        const { writes, unheld } = args as BatchCall;
        let count = 0;
        const result = await host.store.batch(writes, () => { count++; }, { signal, unheld });
        return { result, count } satisfies BatchAnswer;
      }
      if (name === 'saveSummaries') return saveSummaries(host.store, args as string[], signal, (done, total) => this.options.progress?.({ kind: 'summaries', done, total }));
      if (name === 'saveFiles') {
        return host.files.save((args as SaveFilesCall).bytes, { signal, bulk: true });
      }
    }
    throw new Error('Unknown backup host call');
  }
}

// Only ids and bounded scan pages enter the worker; compression, JSON and ZIP validation never execute in the UI.
export async function exportBackup(store: ExportStore, files: ExportFiles, output: BackupOutput, options: Options = {}): Promise<ApiResult<{ left: number; skipped: number }>> {
  let worker: BackupWorker | null = null;
  try {
    worker = new BackupWorker();
    return await worker.run({ kind: 'export' }, { store, files, output }, options);
  } catch {
    await output.abort().catch(() => {});
    return { ok: false, error: options.signal?.aborted ? 'stopped' : 'backup-crashed' };
  } finally { await worker?.close(); }
}

export async function readBackup(file: Blob, options: Options = {}): Promise<{ ok: true; backup: Backup } | BackupFailure> {
  let worker: BackupWorker | null = null;
  try {
    worker = new BackupWorker();
    const read = await worker.run<ReadAnswer>({ kind: 'read', file }, null, options);
    if (read.ok) return { ok: true, backup: { worker, close: () => worker!.close() } };
    await worker.close();
    return read;
  } catch {
    await worker?.close();
    return { ok: false, error: options.signal?.aborted ? 'stopped' : 'backup-crashed' };
  }
}

export async function restoreBackup(store: ObjectStore, files: RestoreFiles, backup: Backup, options: Options = {}): Promise<ApiResult<{ skipped: number }>> {
  try {
    return await store.pinned((pin) => backup.worker.run({ kind: 'restore', pin }, { store, files }, options), options.signal);
  } catch {
    return { ok: false, error: options.signal?.aborted ? 'stopped' : 'backup-crashed' };
  }
}
