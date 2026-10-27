import { refOf, sameModelRef } from '../connectors/assignment';
import { costUnit, modelSettings, resolveConnection } from '../connectors/registry';
import { leastReasoning, type ModelSettings, type Pdf } from '../connectors/settings';
import type { Cost } from '../connectors/types';
import { fingerprint } from '../engine/memory';
import type { Assembled, RanAway } from '../engine/pipeline';
import { coverage, placeBrief, prereadPlan, savedCost, type Covered } from '../engine/preread';
import type { ChatScope } from '../engine/render';
import type { Chat, Receipt } from '../model/chat';
import { EMPTY_SETTINGS, SETTINGS_ID, type PrereadSettings } from '../model/settings';
import type { ApiFailure } from './api';
import { chatModel, type Route, type RouteFailure } from './assignment';
import { evaluatingTask } from './evaluation';
import { taskWriter } from './profiles';
import { prereadPrompt } from './prompts';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { pageAnswer } from './talk';
import { tokenProjection } from './token-calibration';
import { chatPlace, keepRow } from './usage';

// 토큰 절약 (runtime/turn prepare): the 보조 model reads the chosen parts of the request and writes a brief the chat model
// gets in their place (engine/preread).

// Keep system rules out of paraphrases; defaults use six recent messages and a 4,000-o200k-token refresh threshold.
// thinkLess defaults on: Flash reasoning cost 71% of the first live brief call (user, 2026-10-19).
export const PREREAD_STARTS: PrereadSettings = { parts: { chat: true, system: false, lore: true }, recent: 6, batch: 4000, thinkLess: true };

export function prereadSetup(store: Pick<ObjectStore, 'get'>): PrereadSettings {
  const own = store.get('settings', SETTINGS_ID)?.value.preread;
  return { parts: { ...PREREAD_STARTS.parts, ...own?.parts }, recent: own?.recent ?? PREREAD_STARTS.recent, batch: own?.batch ?? PREREAD_STARTS.batch, thinkLess: own?.thinkLess ?? PREREAD_STARTS.thinkLess };
}

// Who writes a chat's brief: the 토큰 절약 prompt's own model, else the chat's 보조 모델, else its 대화 모델.
export function briefWriterOf(store: Pick<ObjectStore, 'get'>, chat: Chat): ReturnType<typeof taskWriter> | { kind: 'prompt-missing' } {
  const prompt = prereadPrompt(store);
  return prompt.kind === 'missing' ? { kind: 'prompt-missing' } : taskWriter(store, chat, prompt.prompt.value.model);
}

// Whether the 대화 모델 writes the chat's brief itself, reading the whole material before it writes the reply too.
export function briefsWithChatModel(store: Pick<ObjectStore, 'get'>, chat: Chat): boolean {
  const writer = briefWriterOf(store, chat);
  const main = chatModel(store, chat, 'main');
  return !('kind' in writer) && !('kind' in main) && sameModelRef(refOf(writer.route.connection.id, writer.route.model), refOf(main.connection.id, main.model));
}

export const setPreread = (store: ObjectStore, change: Partial<PrereadSettings>) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, preread: { ...current.preread, ...change } }));

// failed: the call failed, or answered with no brief. Either fails the turn: sending the whole prompt unasked could cost
// many times more and overflow the chat model's window.
export type PrereadFailure =
  | RouteFailure
  | { kind: 'prompt-missing' }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | RanAway
  | { kind: 'stopped' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'unsaved'; failure: ApiFailure };

export type Preread = NonNullable<Receipt['preread']>;
// The reply's receipt makes it whole: what the brief saved is counted in the reply's own tokens, as its usage and its
// o200k measurement show them, since o200k overcounts some languages (Korean on Gemini by about a fifth).
export type Settle = (reply: Receipt) => Preread;

// Reuse the latest chat brief until uncovered tokens reach batch or content is stale.
// Key includes writing prompt/model; page-only state, rebuilt after reload.
export type Briefs = Map<string, { key: string; brief: string; tokens: number; covered: Covered[]; receipt: Receipt }>;

// The material always goes as a PDF where the route can take one, whatever the 토큰 절약 model's 설정 묶음 says: the cheap
// read is why this step exists. The instruction ahead of it stays out of the PDF.
const PACKED: Pdf = { keep: 'system', recent: 0 };
const packs = ({ connection, model }: Route) => modelSettings(connection.value, model)?.pdf !== false;

function briefSettings({ route, settings }: { route: Route; settings: ModelSettings }, thinkLess: boolean): ModelSettings {
  const schema = modelSettings(route.connection.value, route.model);
  const least = thinkLess && schema && leastReasoning(schema);
  return { ...settings, ...(packs(route) && { pdf: PACKED }), ...(least && { reasoning: least }) };
}

type Deps = Pick<Session, 'store' | 'tokens' | 'credentials' | 'log' | 'briefs'>;

// main: the chat model's route, whose input price the saving is counted at. shown: the 토큰 절약 call is about to start, or is sent again,
// which the reply's placeholder says. A request with less to shorten than batch, and no brief to reuse, goes as it is.
export async function preread(session: Deps, chat: string, stored: Chat, scope: ChatScope, sent: Assembled, main: Route, seed: string, signal: AbortSignal, shown: (retrying?: true) => void): Promise<{ prompt: Assembled; preread: Settle | null } | PrereadFailure> {
  const { store, briefs } = session;
  const raw = { prompt: sent, preread: null };
  const setup = prereadSetup(store);
  const plan = prereadPlan(sent, setup);
  if (!plan) return raw;
  const kept = briefs.get(chat);
  const cover = kept && coverage(sent, plan, kept.covered, new Set(scope.messages.map(({ message }) => message)));
  const fresh = cover && !cover.stale && cover.replaced.length > 0 ? cover : null;
  if (!fresh && plan.tokens < setup.batch) return raw;
  const prompt = prereadPrompt(store);
  if (prompt.kind === 'missing') return { kind: 'prompt-missing' };
  const writer = briefWriterOf(store, stored);
  if ('kind' in writer) return writer;
  const { route } = writer;
  const key = fingerprint([{ role: 'prompt', text: `${prompt.prompt.id}:${prompt.prompt.rev}` }, { role: 'model', text: `${route.connection.id}:${route.model.id}` }]);
  const unit = costUnit(resolveConnection(main.connection.value)?.type ?? null);
  const shortened = (replaced: number[], brief: string, tokens: number, receipt: Receipt, spent: Cost | null, reused: boolean) => {
    const material = replaced.reduce((sum, at) => sum + sent.parts[at]!.tokens, 0);
    const settle: Settle = (reply) => {
      const ratio = reply.calibration ? tokenProjection(reply.calibration, reply.usage).ratio : null;
      const saved = ratio === null ? null : savedCost((material - tokens) * ratio, main.model.price, unit, spent);
      return { material, brief: tokens, receipt, saved, ...(reused && { reused: true as const }) };
    };
    return { prompt: placeBrief(sent, replaced, brief, tokens), preread: settle };
  };
  if (fresh && kept!.key === key && (fresh.uncovered === 0 || fresh.uncovered < setup.batch)) return shortened(fresh.replaced, kept!.brief, kept!.tokens, kept!.receipt, { unit, amount: 0, source: 'price-list' }, true);
  if (plan.tokens < setup.batch) return raw;
  shown();
  const assembled = await evaluatingTask(store.evaluation.preread({ asker: 'send', chat }, { scope, prompt: prompt.prompt.value, material: plan.material, seed }, signal));
  if ('kind' in assembled) return assembled;
  const answer = await pageAnswer(session, { route, settings: briefSettings(writer, setup.thinkLess) }, 'preread', chat, assembled.messages, signal, () => shown(true));
  if ('kind' in answer) return answer;
  const brief = answer.text.trim();
  if (!brief) return { kind: 'failed', receipt: answer.receipt };
  const { receipt } = answer;
  await keepRow(store, receipt, Date.now(), chatPlace(store, chat));
  const counted = await evaluatingTask(store.evaluation.count([brief]));
  if ('kind' in counted) return counted;
  const tokens = counted[0]!;
  briefs.set(chat, { key, brief, tokens, covered: plan.covered, receipt });
  return shortened(plan.taken, brief, tokens, receipt, receipt.cost === 'pending' ? null : receipt.cost, false);
}
