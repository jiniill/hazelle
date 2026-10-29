import { costUnit, resolveConnection } from '../../connectors/registry';
import { priceCost } from '../../connectors/pricing';
import type { Cost } from '../../connectors/types';
import { refOf, type ModelRef } from '../../connectors/assignment';
import { pluginAskMessages, readPluginAnswer, type PluginAnswer } from '../../engine/plugin-writer';
import type { Receipt } from '../../model/chat';
import api from '../../tool-api/hazelle.d.ts?raw';
import type { ApiFailure } from '../api';
import { sharedModel, type RouteFailure } from '../assignment';
import { retriesOf } from '../connections';
import type { Credentials } from '../credential';
import { gather, generate, receiptOf, unsettled } from '../generate';
import { modelProfile } from '../profiles';
import type { RequestLog } from '../request-log';
import type { ObjectStore } from '../store';
import { callOf, endCall, pageCall } from '../streams';
import type { Tokens } from '../token-calibration';
import { keepRow } from '../usage';

type Deps = { store: ObjectStore; credentials: Credentials; log: RequestLog; tokens: Tokens };
type Input = { body: string | null; ask: string; model: ModelRef | null };
export type PluginAsked = { ok: true; answer: PluginAnswer; model: ModelRef; cost: Cost | null } | { ok: false; failure: RouteFailure | { kind: 'profile-missing'; own: boolean } | { kind: 'stopped' } | { kind: 'failed'; receipt: Receipt } | { kind: 'unsaved'; failure: ApiFailure } };

export async function askPlugin(deps: Deps, input: Input, signal: AbortSignal, onText: (text: string) => void): Promise<PluginAsked> {
  const { store, credentials, log, tokens } = deps;
  const route = sharedModel(store, 'main', input.model);
  if ('kind' in route) return { ok: false, failure: route };
  const profile = modelProfile(store, route.model);
  if (profile.kind === 'missing') return { ok: false, failure: { kind: 'profile-missing', own: profile.own } };
  if (signal.aborted) return { ok: false, failure: { kind: 'stopped' } };
  const call = await pageCall({ store, tokens }, route, 'script', null);
  const text = gather(onText);
  try {
    const answer = await generate({
      credentials,
      log,
      connection: route.connection.value,
      model: route.model,
      settings: profile.profile.value.settings,
      retries: retriesOf(store, route.connection.value, profile.profile.value.settings),
      messages: pluginAskMessages(api, input.body, input.ask),
      call,
      signal,
      onText: text.add,
    });
    const receipt = unsettled(receiptOf(callOf(route), answer));
    const saved = await keepRow(store, receipt, Date.now(), { chat: null, character: null });
    if (!saved.ok) return { ok: false, failure: { kind: 'unsaved', failure: saved } };
    if (answer.cut === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
    if (answer.state === 'failed' || !text.value().trim()) return { ok: false, failure: { kind: 'failed', receipt } };
    return { ok: true, answer: readPluginAnswer(text.value()), model: refOf(route.connection.id, route.model), cost: receipt.cost === 'pending' ? null : receipt.cost };
  } finally {
    endCall(store, call.id);
  }
}

// One full file out: the current file's tokens, or 1,024 for a first draft, within the user's output cap. An estimate
// from the catalog price, never a quote: reasoning and cache hits are not foreseen.
export async function askEstimate(deps: Pick<Deps, 'store'>, input: Input): Promise<Cost | null> {
  const route = sharedModel(deps.store, 'main', input.model);
  if ('kind' in route || !route.model.price) return null;
  const profile = modelProfile(deps.store, route.model);
  if (profile.kind === 'missing') return null;
  const messages = pluginAskMessages(api, input.body, input.ask);
  const counts = await deps.store.evaluation.count([...messages.map(({ content }) => content), ...(input.body === null ? [] : [input.body])]).catch(() => null);
  if (!Array.isArray(counts)) return null;
  const fileTokens = input.body === null ? 1024 : counts.pop()!;
  const outputTokens = Math.min(fileTokens, profile.profile.value.settings.maxOutput ?? Infinity);
  return priceCost(route.model.price, { inputTokens: counts.reduce((sum, count) => sum + count, 0), outputTokens, cachedInputTokens: null, cacheWriteInputTokens: null, reasoningTokens: null }, costUnit(resolveConnection(route.connection.value)?.type ?? null));
}
