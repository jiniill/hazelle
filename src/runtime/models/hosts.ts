import { resolveConnection } from '../../connectors/registry';
import type { Connection, Host } from '../../connectors/types';
import { relayJson, type RelayFailure } from './relay';

export type HostsFailure = RelayFailure | { kind: 'not-hosts' };
export type HostsResult = { ok: true; hosts: Host[] } | { ok: false; failure: HostsFailure };

// null for a connection whose type lists no hosts. The list is public: no credential is sent.
export function loadHosts(connection: Connection, model: string, signal?: AbortSignal): Promise<HostsResult> | null {
  const type = resolveConnection(connection)?.type;
  const hosts = type?.hosts;
  if (!hosts) return null;
  return relayJson(hosts.request(model), signal, undefined, undefined, type).then((answer): HostsResult => {
    if (!answer.ok) return answer;
    const parsed = hosts.parse(answer.data);
    return parsed ? { ok: true, hosts: parsed } : { ok: false, failure: { kind: 'not-hosts' } };
  });
}
