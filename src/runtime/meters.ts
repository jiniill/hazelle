import { resolveConnection } from '../connectors/registry';
import type { Account, Connection, Meter } from '../connectors/types';
import { relayJson, type RelayFailure } from './relay';

export type MetersFailure = RelayFailure | { kind: 'not-meters' };
// A request that failed adds nothing to meters and its failure to failures; the others still answer. plan: the first
// the answers name.
export type MetersResult = { meters: Meter[]; failures: MetersFailure[]; plan: string | null };

// null for a connection whose type reports no meters. Not cached here: runtime/pool holds what the pick reads.
export function loadMeters(connection: Connection, account: Account, signal?: AbortSignal): Promise<MetersResult> | null {
  const type = resolveConnection(connection)?.type;
  const requests = type?.meters;
  if (!requests) return null;
  return Promise.all(
    requests.map(async ({ request, parse, plan }): Promise<{ meters: Meter[]; plan: string | null } | MetersFailure> => {
      const answer = await relayJson(request(account.secret), signal, undefined, undefined, type);
      if (!answer.ok) return answer.failure;
      const meters = parse(answer.data);
      return meters ? { meters, plan: plan?.(answer.data) ?? null } : { kind: 'not-meters' };
    }),
  ).then((answers) => ({
    meters: answers.flatMap((answer) => ('meters' in answer ? answer.meters : [])),
    failures: answers.flatMap((answer) => ('meters' in answer ? [] : [answer])),
    plan: answers.map((answer) => ('meters' in answer ? answer.plan : null)).find((plan) => plan !== null) ?? null,
  }));
}
