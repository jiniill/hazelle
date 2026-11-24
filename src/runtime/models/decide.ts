import { decideAnswer, decideRequest, decideRoute } from '../../connectors/registry';
import type { DecideQuestion, Decision } from '../../connectors/types';
import type { Receipt } from '../../model/chat';
import type { Route } from './assignment';
import type { Credentials } from './credential';
import { openPlain } from './plain';
import type { RequestLog } from './request-log';

export type Decided = { ok: true; model: string; answers: Record<string, Decision> } | { ok: false; reason: 'flood' | 'failed' };

const UNSPENT = { usage: null, cost: null };

// One call answers every question, counted among the chat's bot calls. Caller owns consent and the model's choice. Null
// receipt means no network and no log.
export async function decide(
  deps: { credentials: Credentials; log: RequestLog },
  { connection, model }: Route,
  input: string,
  questions: Record<string, DecideQuestion>,
  chat: string,
  signal: AbortSignal,
): Promise<{ answer: Decided; receipt: Receipt | null }> {
  const ended = ({ reason, receipt }: { reason: 'flood' | 'failed'; receipt: Receipt | null }) => ({ answer: { ok: false as const, reason }, receipt });
  const route = decideRoute(connection.value, model);
  if (!route) return ended({ reason: 'failed', receipt: null });
  const call = await openPlain(deps, { connection, model }, route, { chat, purpose: 'script' }, signal);
  if (!call) return ended({ reason: 'failed', receipt: null });
  const answer = await call.send(decideRequest(route, model, input, questions), true);
  if (!answer.ok) return ended(call.refused(answer.failure, UNSPENT));
  const parsed = decideAnswer(route, model, answer.data, questions);
  if (!parsed) return ended(call.failed({ kind: 'bad-event', detail: 'not a decision answer' }, UNSPENT));
  return { answer: { ok: true, model: model.id, answers: parsed.answers }, receipt: call.receipt({ state: 'done', cut: null, error: null }, parsed, JSON.stringify(answer.data)) };
}
