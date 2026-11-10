import type { Restore, RestoreAction, RestorePoint, RestoreRun } from '../../contracts/admin';
import { api, SLOW_ROUTE_WAIT, type ApiResult } from '../api';

// Restores of one account, asked by the operator for it (whose: its id) or by the signed-in account for itself (null).

// post: the operator-only post the operator answers; the account's own restores name none.
export type RestoreAsk = ({ at: number } | { undoes: number }) & { post?: number };

const base = (whose: string | null) => (whose === null ? 'account' : `admin/accounts/${whose}`);

export async function readRestores(whose: string | null): Promise<ApiResult<Restore[]>> {
  const answer = await api<{ restores: Restore[] }>('GET', `${base(whose)}/restores`);
  return answer.ok ? { ok: true, data: answer.data.restores } : answer;
}

export async function readPoints(whose: string | null): Promise<ApiResult<RestorePoint[]>> {
  const answer = await api<{ points: RestorePoint[] }>('GET', `${base(whose)}/points`);
  return answer.ok ? { ok: true, data: answer.data.points } : answer;
}

// The server runs the restore in this request, so the answer comes when it is done or stopped.
export const beginRestore = (whose: string | null, ask: RestoreAsk) => api<RestoreRun>('POST', `${base(whose)}/restores`, ask, undefined, SLOW_ROUTE_WAIT);
export const continueRestore = (whose: string | null, restore: number, action: RestoreAction) =>
  api<RestoreRun>('POST', `${whose === null ? 'account' : 'admin'}/restores/${restore}/${action}`, undefined, undefined, SLOW_ROUTE_WAIT);
