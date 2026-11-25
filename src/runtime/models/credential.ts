import { resolveConnection, type Resolved } from '../../connectors/registry';
import { ConnectorError, type Connection, type Token } from '../../connectors/types';
import type { HttpRequest } from '../../contracts/http';
import { Pool, type PoolFailure } from './pool';
import { transportProblem, relayJson, type RelayFailure } from './relay';

export type CredentialFailure = RelayFailure | { kind: 'no-token' } | { kind: 'refused'; code: string };
type CredentialResult = { ok: true; credential: string } | { ok: false; failure: CredentialFailure };

// A token is traded again a minute before it runs out, so a reply never starts on a dying one.
const MARGIN_MS = 60 * 1000;

// The tokens are secrets, so close() drops them and stops every trade still under way. pool picks the account whose
// secret is traded.
export class Credentials {
  readonly pool = new Pool();
  private readonly tokens = new Map<string, Token>();
  private readonly closing = new AbortController();

  async get({ type }: Resolved, secret: string, signal?: AbortSignal): Promise<CredentialResult> {
    const problem = transportProblem(type);
    if (problem) return { ok: false, failure: problem };
    if (!type?.exchange) return { ok: true, credential: secret };
    const key = JSON.stringify([type.id, secret]);
    const kept = this.tokens.get(key);
    if (kept && kept.expiresAt - MARGIN_MS > Date.now()) return { ok: true, credential: kept.value };
    let request: HttpRequest;
    try {
      request = await type.exchange.request(secret);
    } catch (error) {
      if (error instanceof ConnectorError) return { ok: false, failure: { kind: 'refused', code: error.code } };
      throw error;
    }
    const answer = await relayJson(request, signal ? AbortSignal.any([signal, this.closing.signal]) : this.closing.signal, undefined, undefined, type);
    if (!answer.ok) return answer;
    // A trade answered after close() is never kept: it would outlive the vault it came from.
    if (this.closing.signal.aborted) return { ok: false, failure: { kind: 'stopped' } };
    const token = type.exchange.parse(answer.data);
    if (!token) return { ok: false, failure: { kind: 'no-token' } };
    this.tokens.set(key, token);
    return { ok: true, credential: token.value };
  }

  // One call's credential, from the account the pool picks. stale: the call failed, so that account's meters are read
  // again before the next pick; a credential that failed did so already.
  async use(connection: Connection, signal: AbortSignal): Promise<{ ok: true; credential: string; resolved: Resolved; stale: () => void } | { ok: false; failure: PoolFailure | CredentialFailure }> {
    const picked = await this.pool.pick(connection);
    if (!picked.ok) return picked;
    const stale = () => this.pool.stale(connection, picked.account);
    const resolved = resolveConnection(connection)!;
    const credential = await this.get(resolved, picked.account.secret, signal);
    if (!credential.ok) {
      if (credential.failure.kind !== 'stopped') stale();
      return credential;
    }
    return { ok: true, credential: credential.credential, resolved, stale };
  }

  close() {
    this.pool.close();
    this.closing.abort();
    this.tokens.clear();
  }
}
