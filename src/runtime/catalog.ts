import { MODELS_DEV_LISTS, type ModelsDevList } from '../connectors/models-dev';
import { joinModelsDev } from '../connectors/pricing';
import { catalogRequest, CONNECTION_TYPES, parseCatalog, resolveConnection, withCredential } from '../connectors/registry';
import type { Account, Connection, Model } from '../connectors/types';
import { onTurn } from '../model/turns';
import { api } from './api';
import type { CredentialFailure, Credentials } from './credential';
import { relayJson, transportProblem } from './relay';

export type CatalogFailure = CredentialFailure | { kind: 'refused'; code: string } | { kind: 'not-a-catalog' };
export type CatalogResult = { ok: true; models: Model[] } | { ok: false; failure: CatalogFailure };

export const catalogKey = (connection: Connection): string => JSON.stringify([connection.type, connection.baseUrl, connection.protocol, connection.accounts.map((account) => account.secret)]);

const TTL_MS = 5 * 60 * 1000;

// Cache keys hold API keys, so close() drops them.
export class Catalogs {
  private readonly cache = new Map<string, { at: number; result: Promise<CatalogResult> }>();

  constructor(private readonly credentials: Credentials) {}

  load(connection: Connection, { fresh = false } = {}): Promise<CatalogResult> {
    const key = catalogKey(connection);
    const hit = this.cache.get(key);
    if (hit && !fresh && performance.now() - hit.at < TTL_MS) return hit.result;
    const result = this.fetch(connection);
    this.cache.set(key, { at: performance.now(), result });
    // A failure is not kept, so the next visit asks again.
    void result.then((outcome) => outcome.ok || this.cache.delete(key));
    return result;
  }

  close() {
    this.cache.clear();
  }

  // Use the prospective serving account, falling back to the current group's first: listing models must not need allowance.
  private async serving(connection: Connection): Promise<Account> {
    const picked = await this.credentials.pool.pick(connection);
    return picked.ok ? picked.account : (onTurn(connection, Date.now())[0] ?? connection.accounts[0]!);
  }

  private async fetch(connection: Connection): Promise<CatalogResult> {
    const resolved = resolveConnection(connection);
    // A type this version knows resolves to nothing only for a secret it cannot read.
    if (!resolved) return { ok: false, failure: { kind: 'refused', code: CONNECTION_TYPES.some(({ id }) => id === connection.type) ? 'unreadable-key' : 'unknown-connection-type' } };
    const problem = transportProblem(resolved.type);
    if (problem) return { ok: false, failure: problem };
    if (!resolved.codec) return { ok: true, models: resolved.models };
    // A provider that lists no models (Voyage AI): its type holds the list, and nothing is fetched.
    if (resolved.type?.models) return { ok: true, models: resolved.type.models };
    // A failed models.dev fetch must not fail the provider list or invent its unknown prices/capabilities.
    const list = resolved.type && MODELS_DEV_LISTS[resolved.type.id]?.list;
    const listed = list ? api<ModelsDevList>('GET', `models-dev?provider=${encodeURIComponent(list)}`) : null;
    const credential = await this.credentials.get(resolved, (await this.serving(connection)).secret);
    if (!credential.ok) return credential;
    const response = await relayJson(withCredential(resolved, catalogRequest(resolved), credential.credential), undefined, undefined, undefined, resolved.type);
    if (!response.ok) return response;
    const models = parseCatalog(resolved, response.data);
    if (!models) return { ok: false, failure: { kind: 'not-a-catalog' } };
    const loaded = await listed;
    return { ok: true, models: joinModelsDev(models, loaded?.ok ? loaded.data : null) };
  }
}
