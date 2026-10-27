import { ChangeSignal } from '../change-signal';
import type { Account, Connection } from '../connectors/types';
import { onTurn, schedule } from '../model/turns';
import { loadMeters, type MetersResult } from './meters';

const FRESH_MS = 5 * 60 * 1000;

// group: the current group's name, which holds no account.
export type PoolFailure = { kind: 'pool'; group: string };

export type PickResult = { ok: true; account: Account } | { ok: false; failure: PoolFailure };

export type Allowance = 'available' | 'spent' | 'unknown';

// No figure at all (an unlimited plan, an organization's pool) leaves the allowance available.
export function allowance(result: MetersResult): Allowance {
  if (result.meters.some((meter) => meter.kind === 'left' && meter.amount <= 0)) return 'spent';
  return result.failures.length ? 'unknown' : 'available';
}

export const accountName = (account: Account) => account.name ?? account.id;

export const metersKey = (connection: Connection, account: Account) => JSON.stringify([connection.type, connection.baseUrl, account.secret]);

type Known = { at: number; result: Promise<MetersResult>; settled?: MetersResult };

// Which account serves a reply. Only an exhausted allowance moves the pick on: a rate limit or a refusal never does,
// and a failed reply is never sent again on another account (GitHub's terms, as read for Copilot).
// The meters it reads are held in page memory only, never stored: they move with every reply, and keys are secrets.
export class Pool {
  private readonly known = new Map<string, Known>();
  private readonly closing = new AbortController();
  private readonly changes = new ChangeSignal();
  private reads = 0;

  // For screens that show what peek and held say: notified when a read settles.
  readonly subscribe = this.changes.subscribe;
  readonly settled = () => this.reads;

  // null for a type that reports no meters. A read that failed is not kept, so the next asks again.
  meters(connection: Connection, account: Account, { fresh = false } = {}): Promise<MetersResult> | null {
    const key = metersKey(connection, account);
    const held = this.known.get(key);
    if (held && !fresh && performance.now() - held.at < FRESH_MS) return held.result;
    const result = loadMeters(connection, account, this.closing.signal);
    if (!result || this.closing.signal.aborted) return result;
    const entry: Known = { at: performance.now(), result };
    this.known.set(key, entry);
    void result.then((settled) => {
      if (this.known.get(key) !== entry) return;
      if (settled.failures.length) this.known.delete(key);
      else entry.settled = settled;
      this.reads += 1;
      this.changes.notify();
    });
    return result;
  }

  // Pick first known allowance in the current group; else first unknown, else first account.
  // Provider decides overage eligibility; zero allowance can still serve (user, 2026-10-06). Refresh stale meters together.
  async pick(connection: Connection): Promise<PickResult> {
    if (!connection.turns) return { ok: true, account: connection.accounts[0]! };
    const now = Date.now();
    const group = schedule(connection.turns, now).active.name;
    const accounts = onTurn(connection, now);
    if (!accounts.length) return { ok: false, failure: { kind: 'pool', group } };
    const states = await Promise.all(
      accounts.map(async (account): Promise<Allowance> => {
        const result = this.meters(connection, account);
        return result ? allowance(await result) : 'available';
      }),
    );
    const at = [states.indexOf('available'), states.indexOf('unknown'), 0].find((index) => index >= 0)!;
    return { ok: true, account: accounts[at]! };
  }

  // The pick the last-known meters make, with no network call; null where they cannot tell.
  peek(connection: Connection): Account | null {
    if (!connection.turns) return connection.accounts[0]!;
    const accounts = onTurn(connection, Date.now());
    for (const account of accounts) {
      const settled = this.known.get(metersKey(connection, account))?.settled;
      const state = settled ? allowance(settled) : 'unknown';
      if (state === 'available') return account;
      if (state === 'unknown') return null;
    }
    return accounts[0] ?? null;
  }

  // What its meters said when last read, with no network call; null where they were never read.
  held(connection: Connection, account: Account): MetersResult | null {
    return this.known.get(metersKey(connection, account))?.settled ?? null;
  }

  // After a reply on it failed, so the next pick reads its meters again.
  stale(connection: Connection, account: Account) {
    this.known.delete(metersKey(connection, account));
  }

  close() {
    this.closing.abort();
    this.known.clear();
    this.changes.clear();
  }
}
