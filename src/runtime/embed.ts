import { embedAnswer, embedRequests, embedRoute, withCredential } from '../connectors/registry';
import type { Cost, EmbedPurpose, HttpRequest, Usage } from '../connectors/types';
import type { Receipt } from '../model/chat';
import type { Route } from './assignment';
import type { Credentials } from './credential';
import { receiptError, type ReplyError } from './generate';
import { pause } from './pause';
import { callLabel, PULSE_ROLE } from './pulse';
import { relayJson } from './relay';
import { redacted, type RequestLog } from './request-log';
import type { ObjectStore } from './store';

export type Embedded = { ok: true; model: string; vectors: number[][] } | { ok: false; reason: 'too-large' | 'flood' | 'failed' };

// Checked before the network, so a tool learns what to split however the provider would have answered.
export const EMBED_TEXTS = 64;
const EMBED_TOKENS = 8192;

// A tokenizer that did not load throws Error('tokenizer').
export const countTexts = (store: Pick<ObjectStore, 'evaluation'>) => async (texts: string[]): Promise<number[]> => {
  const counted = await store.evaluation.count(texts);
  if ('kind' in counted) throw new Error('tokenizer');
  return counted;
};

// Parts of a call split for a provider that takes one text a request (Vertex AI) go a second apart, so indexing a
// chat's memory never spends the account's 240 calls a minute that its replies need.
const PART_GAP = 1000;

// One receipt covers all provider-sized chunks. Count script calls once at the first request, not memory indexing.
// Caller owns consent/model choice; embedded reports chunk progress. Null receipt means no network and no log.
export async function embedTexts(
  deps: { credentials: Credentials; log: RequestLog; count(texts: string[]): Promise<number[]> },
  { connection, model }: Route,
  texts: string[],
  as: EmbedPurpose | null,
  chat: string,
  script: boolean,
  signal: AbortSignal,
  embedded?: (count: number) => void,
): Promise<{ answer: Embedded; receipt: Receipt | null }> {
  const unsent = (reason: 'too-large' | 'flood' | 'failed') => ({ answer: { ok: false as const, reason }, receipt: null });
  if (texts.length > EMBED_TEXTS) return unsent('too-large');
  if (!texts.length) return { answer: { ok: true, model: model.id, vectors: [] }, receipt: null };
  if ((await deps.count(texts)).some((tokens) => tokens > EMBED_TOKENS)) return unsent('too-large');
  const route = embedRoute(connection.value, model);
  if (!route) return unsent('failed');
  const parts = embedRequests(route, model, texts, as);
  const { credentials, log } = deps;
  const picked = await credentials.pool.pick(connection.value);
  if (!picked.ok) return unsent('failed');
  const credential = await credentials.get(route, picked.account.secret, signal);
  if (!credential.ok) return unsent('failed');
  const at = Date.now();
  const began = performance.now();
  const vectors: number[][] = [];
  const spent: { usage: Usage; cost: Cost | null }[] = [];
  const sent: HttpRequest[] = [];
  const receipt = (made: Pick<Receipt, 'state' | 'cut' | 'error'>): Receipt => {
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
      ...summed(spent),
    };
    // Omit vector responses from logs: one batch can evict real replies. Log split request bodies as one call.
    const request = sent.length === 1 ? sent[0]! : { url: sent[0]!.url, body: `[${sent.map(({ body }) => body).join(',')}]` };
    log.record({ chat, purpose: 'embedding', at, picked: false, receipt: kept, request: redacted(request, connection.value), response: null });
    return kept;
  };
  const failed = (error: Exclude<ReplyError, { kind: 'stopped' }>) => {
    credentials.pool.stale(connection.value, picked.account);
    return { answer: { ok: false as const, reason: 'failed' as const }, receipt: receipt({ state: 'failed', cut: null, error: receiptError(error) }) };
  };
  const stopped = () => ({ answer: { ok: false as const, reason: 'failed' as const }, receipt: receipt({ state: 'cut', cut: 'stopped', error: null }) });
  for (const [index, { request, count }] of parts.entries()) {
    if (index && !(await pause(PART_GAP, signal))) return stopped();
    sent.push(request);
    const answer = await relayJson(withCredential(route, request, credential.credential), signal, script && !index ? chat : undefined, callLabel(PULSE_ROLE.embedding, connection.value, model.id), route.type);
    if (!answer.ok) {
      const { failure } = answer;
      // Refused by the server before the provider saw it: the chat's bot calls for this minute are spent.
      if (failure.kind === 'app' && failure.code === 'too-many-bot-calls') return unsent('flood');
      if (failure.kind === 'stopped') return stopped();
      return failed(failure);
    }
    const parsed = embedAnswer(route, model, answer.data, count);
    if (!parsed) return failed({ kind: 'bad-event', detail: 'not an embedding answer' });
    vectors.push(...parsed.vectors);
    spent.push(parsed);
    embedded?.(count);
  }
  return { answer: { ok: true, model: model.id, vectors }, receipt: receipt({ state: 'done', cut: null, error: null }) };
}

// A split call's usage and cost are its parts', unknown where any part's is.
function summed(spent: { usage: Usage; cost: Cost | null }[]): Pick<Receipt, 'usage' | 'cost'> {
  const [first] = spent;
  if (!first) return { usage: null, cost: null };
  const inputs = spent.flatMap(({ usage }) => (usage.inputTokens === null ? [] : [usage.inputTokens]));
  const costs = spent.flatMap(({ cost }) => (cost ? [cost] : []));
  return {
    usage: { ...first.usage, inputTokens: inputs.length === spent.length ? inputs.reduce((sum, tokens) => sum + tokens, 0) : null },
    cost: costs.length === spent.length ? { ...costs[0]!, amount: costs.reduce((sum, cost) => sum + cost.amount, 0) } : null,
  };
}
