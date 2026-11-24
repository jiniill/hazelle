import { embedAnswer, embedRequests, embedRoute } from '../../connectors/registry';
import type { Cost, EmbedPurpose, Usage } from '../../connectors/types';
import type { Receipt } from '../../model/chat';
import type { Route } from './assignment';
import type { Credentials } from './credential';
import { pause } from '../pause';
import { openPlain } from './plain';
import type { RequestLog } from './request-log';
import type { ObjectStore } from '../store/store';

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
// Vector responses stay out of the log: one batch can evict real replies.
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
  const call = await openPlain(deps, { connection, model }, route, { chat, purpose: 'embedding' }, signal);
  if (!call) return unsent('failed');
  const vectors: number[][] = [];
  const spent: { usage: Usage; cost: Cost | null }[] = [];
  const ended = ({ reason, receipt }: { reason: 'flood' | 'failed'; receipt: Receipt | null }) => ({ answer: { ok: false as const, reason }, receipt });
  for (const [index, { request, count }] of parts.entries()) {
    if (index && !(await pause(PART_GAP, signal))) return ended(call.stopped(summed(spent)));
    const answer = await call.send(request, script && !index);
    if (!answer.ok) return ended(call.refused(answer.failure, summed(spent)));
    const parsed = embedAnswer(route, model, answer.data, count);
    if (!parsed) return ended(call.failed({ kind: 'bad-event', detail: 'not an embedding answer' }, summed(spent)));
    vectors.push(...parsed.vectors);
    spent.push(parsed);
    embedded?.(count);
  }
  return { answer: { ok: true, model: model.id, vectors }, receipt: call.receipt({ state: 'done', cut: null, error: null }, summed(spent)) };
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
