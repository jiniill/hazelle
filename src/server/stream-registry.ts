import type { Retry } from '../contracts/streams';
import type { RelayBudget } from './limits';
import type { Upstream } from './relay';
import { LIMIT_BYTES, StreamBox } from './stream-box';
import type { StreamStore } from './db/streams-db';

// The reply streams of this process: at most one StreamBox per name, kept while its call runs or a reader reads it. A
// name with no box is read from its stored pages; after a restart that is every name, and its reply ends as lost.
export type Streams = {
  // signal: the request's; its abort stops counting that request's reader, and the call runs on. counted: once, when the
  // provider's answer after every retry is 2xx.
  start(name: string, body: { id: string; key: unknown; request: unknown; bytes: number; retry?: Retry }, signal: AbortSignal, leave: () => void, counted?: () => void): Promise<Response>;
  read(name: string, from: number, signal: AbortSignal): Promise<Response>;
  stop(name: string): void;
  // The call ends, its readers end, then its rows go.
  drop(name: string): Promise<void>;
  live(): number;
  settled(): Promise<void>;
  expire(now: number): Promise<void>;
  close(): void;
};

// The pages an account's streams keep at once. A client deletes a reply once it has read it, so only what no device
// came back for stays; past this the account's oldest go as a new call starts, or one account's replies, kept a day
// each, would fill the disk.
const KEEP_BYTES = 8 * LIMIT_BYTES;
const accountOf = (name: string) => name.split(':')[0]!;

export function streamRegistry(store: StreamStore, upstream: Upstream, budget: RelayBudget, keep = KEEP_BYTES): Streams {
  const boxes = new Map<string, StreamBox>();
  const box = (name: string) => {
    const found = boxes.get(name);
    if (found) return found;
    const made: StreamBox = new StreamBox(
      store.storage(name),
      upstream,
      () => { if (boxes.get(name) === made) boxes.delete(name); },
      budget.account(accountOf(name)),
    );
    boxes.set(name, made);
    return made;
  };
  const running = () => [...boxes.values()].filter((each) => each.running);
  const drop = async (name: string) => {
    const found = boxes.get(name);
    boxes.delete(name);
    await found?.drop();
    store.remove(name);
  };
  return {
    start: async (name, body, signal, leave, counted) => {
      try {
        for (const old of store.over(accountOf(name), keep)) if (old !== name) await drop(old);
      } catch (error) {
        leave();
        throw error;
      }
      return box(name).start(body, signal, leave, counted);
    },
    read: (name, from, signal) => box(name).read(from, signal),
    stop: (name) => boxes.get(name)?.stop(),
    drop,
    live: () => running().length,
    settled: async () => {
      for (let calls = running(); calls.length; calls = running()) await Promise.all(calls.map((each) => each.ended));
    },
    expire: async (now) => {
      for (const name of store.due(now)) await drop(name);
    },
    close: () => store.close(),
  };
}
