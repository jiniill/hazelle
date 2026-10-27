import type { CacheText } from '../model/cache';
import { SETTINGS_ID } from '../model/settings';
import { chatToggles } from '../model/toggles';
import type { Toggle } from '../model/prompt';
import { chatPrompt } from './prompts';
import { chatTranslate, featuresOf } from './features';
import { retrievalOf } from './retrieval';
import { triggersOf } from './script-selection';
import { toolsOf } from './tools/store';
import { prepareChat } from '../connectors/preparation';
import { seesPictures } from '../connectors/types';
import { batchLane, resolveConnection, resolveModel } from '../connectors/registry';
import { providerFit, type TokenSnapshot } from './token-calibration';
import type { Assembled, PromptInput } from '../engine/pipeline';
import type { EvaluatedPrompt } from './evaluation-core';
import type { ChatScope } from '../engine/render';
import { shown, type Chat, type Message } from '../model/chat';
import { live } from '../model/library';
import { chatModel, type RouteFailure } from './assignment';
import { wireOf, wireTextOf, type CacheSend } from './cache';
import { answerInstructionOf, asSent, budgetOf, packsOf, tokenLimits, scopeOf, sentSettings } from './chat-context';
import type { Said } from './chat-log';
import { cacheViewOf } from './generate';
import { redacted, type SentRequest } from './request-log';
import { memoryFill } from './memory-read';
import { chatPersona, type PersonaSource } from './personas';
import { modelProfile } from './profiles';
import type { Session } from './session';
import type { Ask, Turn } from './talk';

type Reader = Pick<Session, 'store'>;

export type Target =
  | { kind: 'send'; text: string }
  | { kind: 'answer' }
  | { kind: 'regenerate'; message: string }
  | { kind: 'retry'; message: string; version: string }
  | { kind: 'continue'; message: string; version: string };

// own says whether the missing one was the chat's (the model's) own or the default.
export type Blocked = RouteFailure | { kind: 'prompt-missing'; own: boolean } | { kind: 'persona-missing'; from: PersonaSource } | { kind: 'profile-missing'; own: boolean };

const BLOCKED = { 'no-model': true, 'model-gone': true, 'image-only': true, 'prompt-missing': true, 'persona-missing': true, 'profile-missing': true } as const satisfies Record<Blocked['kind'], true>;

export const isBlocked = (failure: { kind: string }): failure is Blocked => Object.hasOwn(BLOCKED, failure.kind);

// Read once when it is asked for, the user's new message last in its messages.
export type TurnContext = Pick<Ask, 'route' | 'settings' | 'said'> & Pick<Turn, 'reply'> & Pick<PromptInput, 'scope' | 'budget' | 'memory' | 'pictures'> & { chat: Chat };

function sendable({ store }: Reader, scope: ChatScope, chat: Chat): PromptInput['scope'] | Blocked {
  const { prompt, persona } = scope;
  if (!prompt) return { kind: 'prompt-missing', own: chat.prompt !== undefined };
  if (!persona) return { kind: 'persona-missing', from: chatPersona(store, chat).from };
  return { ...scope, prompt, persona };
}

// null: nothing stops the chat from starting a turn. The screen asks before it saves a new chat.
export function blocked(reader: Reader, chat: Chat): Blocked | null {
  const route = chatModel(reader.store, chat, 'main');
  if ('kind' in route) return route;
  const profile = modelProfile(reader.store, route.model);
  if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
  const scope = sendable(reader, scopeOf(reader, null, chat, []), chat);
  return 'kind' in scope ? scope : null;
}

// A new chat as its first save will write it (useNewChat): its greeting, if it saves one, as its only message.
export type Unsaved = { chat: Chat; messages: Message[] };

// null: the chat, or the message the target names, is gone; for a continue, so is the version it names. ids are
// the ones the turn was shown under, for a new chat shown before it was saved. unsaved: the chat is not saved yet.
export function gatherTurn(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() }, unsaved: Unsaved | null = null): TurnContext | Blocked | null {
  const value = unsaved ? unsaved.chat : live(session.store.get('chat', chat))?.value;
  if (!value) return null;
  const route = chatModel(session.store, value, 'main');
  if ('kind' in route) return route;
  const profile = modelProfile(session.store, route.model);
  if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
  const { settings } = profile.profile.value;

  const messages = unsaved ? unsaved.messages : session.read.chat(chat).snapshot()!.messages;
  const message = 'message' in target ? target.message : null;
  const at = message === null ? messages.length : messages.findIndex((candidate) => candidate.id === message);
  if (at === -1) return null;
  const index = 'version' in target ? messages[at]!.versions.findIndex((version) => version.id === target.version) : -1;
  const version = messages[at]?.versions[index];
  // 이어 쓰기 continues the version it names. So does 다시 시도 on a continuation that failed, so that neither the text
  // it continues nor the calls its receipt carries are dropped.
  const continues = version?.receipt && (target.kind === 'continue' || version.receipt.continues) ? { text: version.text, receipt: version.receipt, seed: version.seed, ...(version.reasoning && { reasoning: version.reasoning }) } : null;
  if (target.kind === 'continue' && !continues) return null;
  const end = messages.at(-1);
  const follows = end ? shown(end).id : null;
  const said: Said | null = target.kind === 'send' ? { id: ids.said, text: target.text, follows } : null;
  const now = Date.now();
  const sending: Message[] = said ? [{ id: said.id, role: 'user', at: now, versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: now }], selected: 0 }] : [];
  // 반전 모드 sends the messages before the target as the reader reads them. A continuation's prompt ends with the
  // version it continues, as its text, which the continuation is written after.
  const before = asSent(session.store, value, messages.slice(0, at));
  const history = continues ? [...before, { ...messages[at]!, selected: index }] : [...before, ...sending];
  const scope = sendable(session, scopeOf(session, unsaved ? null : chat, value, history), value);
  if ('kind' in scope) return scope;
  return {
    chat: value,
    route,
    settings,
    scope,
    budget: budgetOf(route.model, sentSettings(session.store, route)),
    memory: memoryFill(session.store, unsaved ? null : chat, value, scope.messages),
    pictures: { seen: seesPictures(route.model), moved: value.movedPictures === true },
    said,
    reply: { id: ids.reply, message, replaces: 'version' in target ? target.version : null, ...(message === null && { follows: said ? said.id : follows }), continues },
  };
}

export type Sending = { turn: TurnContext; prompt: Assembled; calibration: TokenSnapshot; input: Omit<PromptInput, 'countTokens'> };
// The prompt was evaluated and cannot go: its CBS ran away, it is over the model's budget, or the tokenizer did not load.
export type Unsendable = Exclude<EvaluatedPrompt, Assembled>;

type Forecaster = Pick<Session, 'store' | 'read' | 'scriptTurns' | 'tokens'>;
type Asker = 'forecast' | 'memory' | 'view';

// For callers that act only on a request that can go.
export const wouldSend = async (session: Forecaster, chat: string, target: Target, signal?: AbortSignal, asker: Asker = 'forecast', unsaved: Unsaved | null = null): Promise<Sending | null> => {
  const sending = await forecastSend(session, chat, target, signal, asker, unsaved);
  return sending && 'kind' in sending ? null : sending;
};

// null: the chat or its turn cannot be gathered, the calibration did not load, or it was aborted. asker: whose forecast
// this is, each with its own evaluation lane, kept with the chat so a forecast sends the worker only what changed since
// its last: the composer's, background memory's (Rememberer) and the memory panel's. One lane shared by two would have
// each cancel the other's. unsaved: a new chat not saved yet, which has no projection to wait for.
export async function forecastSend(session: Forecaster, chat: string, target: Target, signal?: AbortSignal, asker: Asker = 'forecast', unsaved: Unsaved | null = null): Promise<Sending | Unsendable | null> {
  // What the prompt reads may change while it is evaluated: it is gathered and evaluated again once, so a save landing
  // mid-flight does not cost memory its round.
  for (let tries = 0; tries < 2; tries++) {
    const projection = unsaved ? null : await session.store.projections.evaluate(chat);
    if (!unsaved && !projection) return null;
    const { value: turn, reads } = session.store.capture(() => gatherTurn(session, chat, target, undefined, unsaved));
    const revisions = reads.map((read) => session.store.revision(read));
    if (turn === null || 'kind' in turn) return null;
    const snapshot = await session.tokens.snapshot(turn.route, turn.settings, tokenLimits(turn.route.model, sentSettings(session.store, turn.route)), 'conversation', chat, signal ?? new AbortController().signal);
    if (!snapshot.ok) return null;
    const fit = providerFit(turn.route, turn.settings, snapshot.data.fit.allowance);
    const input = { scope: turn.scope, seed: turn.reply.id, budget: turn.budget, fit, ...session.scriptTurns.cachedPrompt(chat, turn), continuing: false, answerInstruction: answerInstructionOf(session.store), pictures: turn.pictures };
    const prompt = await session.store.evaluation.prompt({ asker, chat }, input, signal);
    if (signal?.aborted) return null;
    if ((!projection || session.store.loadedHead(chat) === projection.summary.head) && reads.every((read, at) => session.store.revision(read) === revisions[at])) return 'kind' in prompt ? prompt : { turn, prompt, calibration: snapshot.data, input };
  }
  return null;
}

// account: the account that would serve it (runtime/pool peek).
export function cacheSend({ turn, prompt, calibration }: Pick<Sending, 'turn' | 'prompt' | 'calibration'>, account: string | null): (CacheSend & { wire: CacheText }) | null {
  const view = cacheViewOf(turn.route.connection.value, turn.route.model, turn.settings, prompt.messages);
  if (!view) return null;
  // Prefix composition can differ from the whole request; this remains a lower-bound forecast, not reported eligibility.
  const facts = view.facts && { ...view.facts, minimum: view.facts.minimum === null ? null : Math.ceil(view.facts.minimum / calibration.estimate.lower) };
  return { ...wireOf(turn.route.connection.id, account, view, prompt.parts), facts, wire: wireTextOf(view) };
}

// Preparation shares sending's cache-point selection with cacheSend; headers never leave this helper.
export function previewRequest({ turn, prompt }: Sending): SentRequest | null {
  const resolved = resolveConnection(turn.route.connection.value);
  if (!resolved) return null;
  const route = resolveModel(resolved, turn.route.model);
  const asked = { model: turn.route.model, messages: prompt.messages, settings: turn.settings };
  const { request } = prepareChat(route, { ...asked, settings: batchLane(route, asked) ? { ...asked.settings, streaming: false } : asked.settings });
  return redacted(request, turn.route.connection.value);
}

export type AfterEnter =
  | { kind: 'input-translation' }
  | { kind: 'tools'; modules: string[] }
  | { kind: 'retrieval' }
  | { kind: 'preread' };

export function afterEnter({ store }: Reader, chat: string, turn: TurnContext): AfterEnter[] {
  const result: AfterEnter[] = [];
  if (turn.said && chatTranslate(store, turn.chat).input) result.push({ kind: 'input-translation' });
  const tools = toolsOf(store, turn.chat);
  if (tools.length) result.push({ kind: 'tools', modules: tools.map(({ module }) => module) });
  if (turn.memory?.kind === 'built-in' && retrievalOf(store, chat, turn.scope.messages)) result.push({ kind: 'retrieval' });
  if (featuresOf(store, turn.chat).preread) result.push({ kind: 'preread' });
  return result;
}

export type PackAttachment = { kind: 'settings' | 'prompt' | 'character' | 'persona'; id: string; own: boolean };
export type ModuleContribution = {
  id: string;
  kind: 'character' | 'module';
  name: string;
  attached: PackAttachment[];
  lore: (NonNullable<Assembled['lore']>[number] & { parts: { index: number; tokens: number }[] })[];
  silent: NonNullable<Assembled['silent']>;
  invalidKeys: { entry: string; name: string; keys: string[] }[];
  regex: Record<'input' | 'output' | 'process' | 'display', number>;
  triggers: { lua: number; blocks: number };
  toggles: Toggle[];
  tools: { name: string }[];
};

export function moduleContributions({ store }: Reader, chat: Chat, preview: Assembled): ModuleContribution[] {
  const packs = packsOf(store, chat);
  const character = chat.character === null ? null : store.get('character', chat.character);
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const attachments = [
    { kind: 'settings' as const, id: SETTINGS_ID, modules: store.get('settings', SETTINGS_ID)?.value.modules ?? [] },
    ...(prompt.kind === 'prompt' ? [{ kind: 'prompt' as const, id: prompt.prompt.id, modules: prompt.prompt.value.modules ?? [] }] : []),
    ...(character ? [{ kind: 'character' as const, id: character.id, modules: character.value.modules ?? [] }] : []),
    ...(persona.kind === 'persona' ? [{ kind: 'persona' as const, id: persona.persona.id, modules: persona.persona.value.modules ?? [] }] : []),
  ];
  const tools = toolsOf(store, chat);
  return packs.map((pack) => {
    const regex = { input: 0, output: 0, process: 0, display: 0 };
    for (const script of pack.pack.regex) if (!script.off) regex[script.stage]++;
    const triggers = { lua: 0, blocks: 0 };
    for (const trigger of triggersOf([pack])) triggers[trigger.kind]++;
    return {
      id: pack.id,
      kind: pack.module ? 'module' : 'character',
      name: pack.module ? store.get('module', pack.id)!.value.name : character!.value.card.name,
      attached: pack.module ? attachments.filter(({ modules }) => modules.includes(pack.id)).map(({ kind, id }) => ({ kind, id, own: false })) : [{ kind: 'character', id: pack.id, own: true }],
      lore: (preview.lore ?? []).filter(({ id }) => store.get('lore', id)?.parent === pack.id).map((entry) => ({
        ...entry,
        parts: preview.parts.flatMap(({ from, tokens }, index) => (from.kind === 'lore' || from.kind === 'depth') && from.id === entry.id ? [{ index, tokens }] : []),
      })),
      silent: (preview.silent ?? []).filter(({ id }) => store.get('lore', id)?.parent === pack.id),
      invalidKeys: preview.invalidKeys.filter(({ entry }) => store.get('lore', entry)?.parent === pack.id).reduce<ModuleContribution['invalidKeys']>((list, { entry, name, key }) => {
        const held = list.find((each) => each.entry === entry);
        if (held) held.keys.push(key);
        else list.push({ entry, name, keys: [key] });
        return list;
      }, []),
      regex,
      triggers,
      toggles: chatToggles(pack.pack.toggles),
      tools: tools.filter(({ module }) => module === pack.id).map(({ tool }) => ({ name: tool.manifest.displayName })),
    };
  });
}
