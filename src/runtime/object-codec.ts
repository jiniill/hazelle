import type { SealedChange } from '../contracts/objects';
import { codecValue, type CodecDown, type CodecJob, type CodecResult, type CodecUp, type OpenItem, type SealItem } from './object-codec-core';
import { PendingRequests } from './pending-requests';
import { moduleWorker } from './worker';
import workerUrl from './object-codec-worker?worker&url';

export const OPEN_ITEMS = 64;
export const OPEN_BYTES = 4 * 1024 * 1024;
// Values have no cheap encoded size before the worker serializes them. Bound those atomic objects by count.
export const SEAL_ITEMS = 8;
// Bound CPU workers by spare cores; adding workers beyond them cannot speed decrypt/inflate/parse.
const codecWorkers = () => Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));

export class CodecAborted extends Error {}
export class CodecUnavailable extends Error {}
type CodecTransport = { run(job: CodecJob): Promise<CodecResult[]>; close(): void };

// Per-store workers share a cloned, nonextractable derived key; dispatch to least loaded.
// Any worker crash ends the pool: transport failure must never masquerade as corrupt individual objects.
function objectCodecTransport(account: string, key: CryptoKey, count: number): CodecTransport {
  const workers: Worker[] = [];
  const loads: number[] = [];
  let failure: Error | null = null;
  const pending = new PendingRequests<CodecResult[], number>();
  const end = (error: Error) => {
    failure ??= error;
    for (const worker of workers) worker.terminate();
    pending.rejectAll(() => failure);
  };
  try {
    for (let index = 0; index < count; index++) workers.push(moduleWorker(workerUrl));
  } catch {
    end(new CodecUnavailable('Object codec worker could not start'));
  }
  for (const worker of workers) {
    loads.push(0);
    worker.onmessage = ({ data }: MessageEvent<CodecUp>) => {
      const call = pending.take(data.id);
      if (!call) return;
      loads[call.context]!--;
      call.resolve(data.results);
    };
    worker.onerror = worker.onmessageerror = () => end(new CodecUnavailable('Object codec worker failed'));
    try {
      worker.postMessage({ kind: 'init', account, key } satisfies CodecDown);
    } catch {
      end(new CodecUnavailable('Object codec worker could not initialize'));
    }
  }
  return {
    run: (job) => {
      if (failure) return Promise.reject(failure);
      const index = loads.indexOf(Math.min(...loads));
      loads[index]!++;
      const { id, promise } = pending.add(index);
      try {
        workers[index]!.postMessage({ kind: 'batch', id, job } satisfies CodecDown);
      } catch {
        end(new CodecUnavailable('Object codec request could not be sent'));
      }
      return promise;
    },
    close: () => end(new CodecAborted('Object store closed')),
  };
}

export class ObjectCodec {
  private readonly closing = new AbortController();
  private transport: CodecTransport | null = null;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly account: string, private readonly key: CryptoKey, readonly workers = codecWorkers()) {}

  open(items: OpenItem[], signal: AbortSignal): Promise<CodecResult[]> {
    return this.run({ kind: 'open', items }, signal);
  }

  // Retain only worker-count + 1 decoded windows; admit an oversized atomic object alone.
  // Observe each dispatched promise immediately, including windows abandoned after abort.
  // Strict scans preserve codec errors; ordinary reads treat opening failures as unreadable bodies.
  opener(rows: SealedChange[], signal: AbortSignal, { strict = false, accept }: { strict?: boolean; accept: (row: SealedChange) => boolean }): (index: number) => Promise<unknown> {
    type Window = { end: number; slots: Map<number, number>; batch: Promise<CodecResult[]> };
    const ahead = this.workers + 1;
    const windows: Window[] = [];
    let next = 0;
    const dispatch = () => {
      const items: OpenItem[] = [];
      const slots = new Map<number, number>();
      let bytes = 0;
      for (; next < rows.length && items.length < OPEN_ITEMS; next++) {
        const row = rows[next]!;
        const { id, kind, parent, body, omitted } = row;
        if (typeof body !== 'string' || omitted || (!strict && !accept(row))) continue;
        if (items.length && bytes + body.length > OPEN_BYTES) break;
        slots.set(next, items.length);
        items.push({ id, kind, parent, body });
        bytes += body.length;
      }
      const batch = items.length ? this.open(items, signal) : Promise.resolve([]);
      batch.catch(() => {});
      windows.push({ end: next, slots, batch });
    };
    return async (index) => {
      while (windows.length && windows[0]!.end <= index) windows.shift();
      while (windows.length < ahead && next < rows.length) dispatch();
      const held = windows[0];
      const slot = held?.slots.get(index);
      if (held === undefined || slot === undefined) return undefined;
      const result = (await held.batch)[slot]!;
      return strict ? codecValue(result) : result.ok ? result.value : undefined;
    };
  }

  seal(items: SealItem[], limit: number, signal: AbortSignal): Promise<CodecResult<string | null>[]> {
    return this.run({ kind: 'seal', items, limit }, signal) as Promise<CodecResult<string | null>[]>;
  }

  close() {
    this.closing.abort();
    this.transport?.close();
  }

  // All scopes share one admission queue with one slot per worker. Cancelling a caller rejects it promptly, but an
  // already posted batch keeps its slot until it answers: neither other scopes nor repeated cancelled calls flood the
  // workers' queues.
  private run(job: CodecJob, signal: AbortSignal): Promise<CodecResult[]> {
    const stop = AbortSignal.any([signal, this.closing.signal]);
    const check = () => { if (stop.aborted) throw new CodecAborted('Object codec request stopped'); };
    const work = this.admit().then(async () => {
      try {
        check();
        this.transport ??= objectCodecTransport(this.account, this.key, this.workers);
        const results = await this.transport.run(job);
        check();
        return results;
      } finally {
        // A slot is handed to the next waiter, never freed and retaken: a newcomer could otherwise slip past the queue.
        const next = this.waiting.shift();
        if (next) next();
        else this.active--;
      }
    });
    return new Promise((resolve, reject) => {
      const abort = () => reject(new CodecAborted('Object codec request stopped'));
      if (stop.aborted) abort();
      else stop.addEventListener('abort', abort, { once: true });
      void work.then(resolve, reject).finally(() => stop.removeEventListener('abort', abort));
    });
  }

  private admit(): Promise<void> {
    if (this.active < this.workers) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiting.push(resolve));
  }
}
