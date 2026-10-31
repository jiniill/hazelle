import { Worker } from 'node:worker_threads';

export type SnapshotArchive = { bytes: number; expanded: number; sha256: string };
export type SnapshotJob =
  | { kind: 'archive'; plain: string; gzip: string }
  | { kind: 'base-ids'; whole: string; temp: string; target: string }
  // Reads the live file on a second connection: the caller must hold the account's queue.
  | { kind: 'delta'; live: string; plain: string; baseRev: number }
  | { kind: 'merge'; whole: string; delta: string; onlyIfDeletesHeld: boolean }
  | { kind: 'named'; path: string; now: number; sources: boolean };

export function snapshotJob<T>(job: SnapshotJob): Promise<T> {
  return new Promise((resolve, reject) => {
    const source = import.meta.url.endsWith('.ts');
    const worker = new Worker(new URL(source ? './snapshot-worker.ts' : './snapshot-worker.js', import.meta.url), {
      workerData: job,
      ...(source && { execArgv: ['--import', 'tsx'] }),
    });
    let answer: { value: T } | undefined;
    let failure: Error | undefined;
    worker.once('message', (value: T) => { answer = { value }; });
    worker.once('error', (error) => { failure = error; });
    // Wait for exit even after an error: the caller may now remove the worker's temporary files.
    worker.once('exit', (code) => {
      if (failure) reject(failure);
      else if (code === 0 && answer) resolve(answer.value);
      else reject(new Error(`Snapshot worker (${job.kind}) exited without a result (${code})`));
    });
  });
}

export function archiveSnapshot(plain: string, gzip: string): Promise<SnapshotArchive> {
  return snapshotJob({ kind: 'archive', plain, gzip });
}
