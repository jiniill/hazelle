import { expect, it, vi } from 'vitest';
import { BackupPeer } from './backup-peer';

it('backpressures worker chunks through acknowledgements and rejects pending calls on close', async () => {
  const writes: number[] = [];
  let release!: () => void;
  const host: BackupPeer = new BackupPeer((message) => queueMicrotask(() => worker.receive(structuredClone(message))), async (name, args) => {
    if (name !== 'write') throw new Error('unexpected host call');
    writes.push(args as number);
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const worker: BackupPeer = new BackupPeer((message) => queueMicrotask(() => host.receive(structuredClone(message))), async () => {
    for (const chunk of [1, 2]) await worker.call('write', chunk);
    return 'complete';
  });
  const done = host.call('produce');
  await vi.waitFor(() => expect(writes).toEqual([1]), { interval: 1 });
  release();
  await vi.waitFor(() => expect(writes).toEqual([1, 2]), { interval: 1 });
  release();
  await expect(done).resolves.toBe('complete');
  const pending = host.call('produce');
  const stopped = expect(pending).rejects.toThrow('closed');
  host.close();
  worker.close();
  await stopped;
});

it('isolates send failures and consumes out-of-order answers only once', async () => {
  const sent: number[] = [];
  const error = new Error('send failed');
  const peer = new BackupPeer((message) => {
    if (message.kind !== 'call') return;
    sent.push(message.id);
    if (message.name === 'bad') throw error;
  }, () => {});
  const first = peer.call('first');
  const failed = peer.call('bad');
  const last = peer.call('last');
  await expect(failed).rejects.toBe(error);
  expect(new Set(sent).size).toBe(3);
  peer.receive({ kind: 'answer', id: sent[2]!, ok: true, value: 'last' });
  peer.receive({ kind: 'answer', id: sent[2]!, ok: false, error: 'duplicate' });
  peer.receive({ kind: 'answer', id: sent[1]!, ok: true, value: 'late' });
  peer.receive({ kind: 'answer', id: sent[0]!, ok: false, error: 'remote failed' });
  await expect(last).resolves.toBe('last');
  await expect(first).rejects.toThrow('remote failed');
  const closed = Promise.allSettled([peer.call('waiting'), peer.call('waiting')]);
  peer.close();
  const results = await closed;
  for (const result of results) {
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason.message).toBe('Backup worker is closed');
  }
});
