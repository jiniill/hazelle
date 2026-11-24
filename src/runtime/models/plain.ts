import { withCredential, type Route as Wire } from '../../connectors/registry';
import type { HttpRequest } from '../../contracts/http';
import type { Receipt } from '../../model/chat';
import type { CallPurpose } from '../../model/usage';
import { callLabel, PULSE_ROLE } from '../service/pulse';
import type { Route } from './assignment';
import type { Credentials } from './credential';
import { receiptError, type ReplyError } from './generate';
import { relayJson, type RelayFailure } from './relay';
import { redacted, type RequestLog } from './request-log';

type Made = Pick<Receipt, 'state' | 'cut' | 'error'>;
type Spent = Pick<Receipt, 'usage' | 'cost'>;

// A provider call that streams nothing (an embedding, a decision), sent with one of the connection's accounts: its
// one receipt and log entry, however many requests it took. null where no account or credential serves it, with no
// network and no log.
export async function openPlain(
  { credentials, log }: { credentials: Credentials; log: RequestLog },
  { connection, model }: Route,
  wire: Wire,
  logged: { chat: string; purpose: CallPurpose },
  signal: AbortSignal,
) {
  const picked = await credentials.pool.pick(connection.value);
  if (!picked.ok) return null;
  const credential = await credentials.get(wire, picked.account.secret, signal);
  if (!credential.ok) return null;
  const at = Date.now();
  const began = performance.now();
  const sent: HttpRequest[] = [];
  // response: the provider's answer as it came, where it is worth its place in the log.
  const receipt = (made: Made, spent: Spent, response: string | null = null): Receipt => {
    const kept: Receipt = {
      id: crypto.randomUUID(),
      connection: connection.id,
      account: picked.account.id,
      source: connection.value.label,
      model: model.id,
      modelName: model.name,
      finishReason: null,
      replyId: null,
      firstTextMs: null,
      totalMs: Math.round(performance.now() - began),
      cache: null,
      ...made,
      ...spent,
    };
    // Split request bodies are logged as one call.
    const request = sent.length === 1 ? sent[0]! : { url: sent[0]!.url, body: `[${sent.map(({ body }) => body).join(',')}]` };
    log.record({ ...logged, at, picked: false, receipt: kept, request: redacted(request, connection.value), response });
    return kept;
  };
  const failed = (error: Exclude<ReplyError, { kind: 'stopped' }>, spent: Spent) => {
    credentials.pool.stale(connection.value, picked.account);
    return { reason: 'failed' as const, receipt: receipt({ state: 'failed', cut: null, error: receiptError(error) }, spent) };
  };
  const stopped = (spent: Spent) => ({ reason: 'failed' as const, receipt: receipt({ state: 'cut', cut: 'stopped', error: null }, spent) });
  return {
    // bot: counted among the chat's bot calls (contracts/http).
    send(request: HttpRequest, bot: boolean) {
      sent.push(request);
      return relayJson(withCredential(wire, request, credential.credential), signal, bot ? logged.chat : undefined, callLabel(PULSE_ROLE[logged.purpose], connection.value, model.id), wire.type);
    },
    receipt,
    failed,
    stopped,
    // How a send that was not answered ends the call. Refused by the server before the provider saw it, the chat's bot
    // calls for this minute are spent and nothing is logged.
    refused(failure: RelayFailure, spent: Spent): { reason: 'flood' | 'failed'; receipt: Receipt | null } {
      if (failure.kind === 'app' && failure.code === 'too-many-bot-calls') return { reason: 'flood', receipt: null };
      return failure.kind === 'stopped' ? stopped(spent) : failed(failure, spent);
    },
  };
}
