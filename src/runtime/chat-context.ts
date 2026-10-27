import type { TokenLimits } from '../model/token-calibration';
import { modelSettings } from '../connectors/registry';
import { fit, type ModelSettings } from '../connectors/settings';
import type { Starred } from '../connectors/types';
import type { Display } from '../engine/display';
import type { Card, Pack } from '../engine/import/types';
import type { LoreScan } from '../engine/lorebook/activate';
import type { Box } from '../engine/regex/scripts';
import type { ChatScope } from '../engine/render';
import type { TranslationRequest } from '../engine/translate';
import { keepsPromptOut, shown, type Chat, type Message } from '../model/chat';
import { live } from '../model/library';
import type { Toggle, ToggleLine } from '../model/prompt';
import { without } from '../model/fields';
import { EMPTY_SETTINGS, SETTINGS_ID, type Settings } from '../model/settings';
import { chatToggles, toggleValue } from '../model/toggles';
import { chatModel, type Route } from './assignment';
import { chatTranslate } from './features';
import { greetingOf } from './greetings';
import { chatPersona } from './personas';
import { modelProfile } from './profiles';
import { chatPrompt, type PromptChoice } from './prompts';
import type { ReadModels } from './read-model';
import type { ObjectStore } from './store';
import type { Shown } from './talk';
import type { TranslateInput } from './translate';

type Reader = { store: Pick<ObjectStore, 'get' | 'children' | 'scopeState'> };

// Pack order: character, global modules, prompt modules, character modules, persona modules; first occurrence wins.
// Missing/binned modules are off; module null identifies the character pack (design §6.5).
export function packsOf(store: Reader['store'], chat: Pick<Chat, 'character' | 'prompt' | 'persona'>): { id: string; pack: Pack; module: { namespace: string | null } | null }[] {
  const character = chat.character === null ? null : store.get('character', chat.character);
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const modules = [
    ...new Set([
      ...(store.get('settings', SETTINGS_ID)?.value.modules ?? []),
      ...(prompt.kind === 'prompt' ? (prompt.prompt.value.modules ?? []) : []),
      ...(character?.value.modules ?? []),
      ...(persona.kind === 'persona' ? (persona.persona.value.modules ?? []) : []),
    ]),
  ];
  return [
    ...(character ? [{ id: character.id, pack: character.value.card, module: null }] : []),
    ...modules.flatMap((id) => {
      const module = store.get('module', id)?.value;
      return module && module.deleted === undefined ? [{ id, pack: module, module: { namespace: module.namespace } }] : [];
    }),
  ];
}

// 재귀 검색 is off by default, where Risu's is on (ruled 2026-10-24): chained entries flood a chat with unrelated lore.
export const LORE_SCAN: LoreScan = { scanDepth: 5, tokenBudget: 50_000, recursive: false, fullWordMatching: false };

const SHARED_SCAN = { scanDepth: 'loreDepth', tokenBudget: 'loreBudget', recursive: 'loreRecursive', fullWordMatching: 'loreFullWord' } as const satisfies { [K in keyof LoreScan]: keyof Settings };

// The account's, which every chat follows where its character sets none.
export function sharedLoreScan(store: Reader['store']): LoreScan {
  const settings = store.get('settings', SETTINGS_ID)?.value;
  return {
    scanDepth: settings?.loreDepth ?? LORE_SCAN.scanDepth,
    tokenBudget: settings?.loreBudget ?? LORE_SCAN.tokenBudget,
    recursive: settings?.loreRecursive ?? LORE_SCAN.recursive,
    fullWordMatching: settings?.loreFullWord ?? LORE_SCAN.fullWordMatching,
  };
}

// The default is kept as none, so it follows the default.
export const setSharedLoreScan = <K extends keyof LoreScan>(store: ObjectStore, key: K, value: LoreScan[K]) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (value === LORE_SCAN[key] ? without(current, SHARED_SCAN[key]) : { ...current, [SHARED_SCAN[key]]: value }));

// The character's own over the account's (ruled 2026-10-14), for every lorebook in its chats.
export function loreScanOf(store: Reader['store'], card: Card | null): LoreScan {
  const shared = sharedLoreScan(store);
  const own = card?.loreSettings;
  return {
    scanDepth: own?.scanDepth ?? shared.scanDepth,
    tokenBudget: own?.tokenBudget ?? shared.tokenBudget,
    recursive: own?.recursive ?? shared.recursive,
    fullWordMatching: own?.fullWordMatching ?? shared.fullWordMatching,
  };
}

export const ANSWER_INSTRUCTION = '(OOC: Continue the story with your next reply.)';

export const answerInstructionOf = (store: Reader['store']) => store.get('settings', SETTINGS_ID)?.value.answerInstruction ?? ANSWER_INSTRUCTION;

export const setAnswerInstruction = (store: ObjectStore, text: string) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (text === ANSWER_INSTRUCTION ? without(current, 'answerInstruction') : { ...current, answerInstruction: text }));

export const usageShownOf = (store: Reader['store']) => store.get('settings', SETTINGS_ID)?.value.usageShown ?? false;

export const setUsageShown = (store: ObjectStore, shown: boolean) =>
  store.upsert('settings', (current = EMPTY_SETTINGS) => (shown ? { ...current, usageShown: true } : without(current, 'usageShown')));

// id is null for a chat not saved yet.
export function scopeOf({ store }: Reader, id: string | null, chat: Chat, messages: Message[]): ChatScope {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const card = character?.card ?? null;
  const packs = packsOf(store, chat);
  const cast = (chat.cast ?? []).flatMap((member) => live(store.get('character', member)) ?? []);
  // A 등장인물's lorebook and pictures follow the packs', its pictures with no module namespace, as the character's own.
  const owners = [...packs, ...cast.map(({ id }) => ({ id, module: null }))];
  // The lorebooks in Risu's order: the character's own, the chat's own (채팅 로어북), then the modules', then the cast's.
  const loreOwners = [...packs.filter(({ module }) => !module), ...(id === null ? [] : [{ id }]), ...packs.filter(({ module }) => module), ...cast];
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const route = chatModel(store, chat, 'main');
  const aux = chatModel(store, chat, 'aux');
  const toggles = togglesOf(store, chat, prompt);
  const loaded = id !== null && store.scopeState(id) === 'loaded';
  return {
    card,
    cast: cast.map(({ id, value }) => ({ id, card: value.card })),
    packs: packs.map(({ pack }) => pack),
    persona: persona.kind === 'persona' ? { name: persona.persona.value.name, description: persona.persona.value.description } : null,
    prompt: prompt.kind === 'prompt' ? prompt.prompt.value : null,
    promptOut: keepsPromptOut(card, chat),
    note: chat.note ?? null,
    lore: loreOwners.flatMap(({ id: owner }) => store.children('lore', owner)),
    loreScan: loreScanOf(store, card),
    loreFolders: Object.fromEntries(
      loreOwners.flatMap(({ id }) => {
        const folders = (store.get('character', id) ?? store.get('module', id) ?? store.get('chat', id))?.value.loreFolders ?? [];
        return folders.length > 0 ? [[id, folders.map(({ name }) => name)]] : [];
      }),
    ),
    messages: messages.map((message) => {
      const version = shown(message);
      const after = [...(version.after ?? []), ...(message.after ?? [])];
      return { id: version.id, message: message.id, seed: version.seed, role: message.role, text: version.text, time: version.at, ...(version.staged && { staged: true }), ...(version.before && { before: version.before }), ...(after.length > 0 && { after }), ...(version.byHand && { byHand: version.byHand }) };
    }),
    variables: chat.variables ?? [],
    greeting: card && greetingOf(messages),
    toggles: new Map(toggles.declared.map(({ key }) => [key, toggles.value(key)])),
    model: 'kind' in route ? null : botModel(route, sentSettings(store, route)),
    axModel: 'kind' in aux ? null : aux.model.id,
    clock: { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    assets: owners.flatMap(({ id: owner, module }) => store.children('asset', owner).map(({ id, value }) => ({ id, name: value.name, type: value.type, ...(module && { module: module.namespace }) }))),
    // Held only while the chat is loaded; a chat not saved yet has none.
    inlays: loaded ? store.children('inlay', id).map(({ id, value }) => ({ id, name: value.name, type: value.type, ...(value.attached && { attached: true as const }) })) : [],
    textfiles: loaded ? store.children('textfile', id).map(({ value }) => value) : [],
    modules: packs.flatMap(({ module }) => module?.namespace ?? []),
    faces: {
      char: chat.character === null ? null : (store.children('avatar', chat.character)[0]?.value.thumb ?? null),
      user: persona.kind === 'persona' ? persona.persona.value.picture : null,
    },
    screen: null,
    pick: `${chat.character ?? ''}:${chat.seed ?? id ?? ''}`,
  };
}

// Keep source layouts separate so one source's group lines cannot capture another's toggles.
export type ToggleSource = { from: 'prompt' | 'card' | 'module'; id: string; name: string; lines: ToggleLine[] };
export type ChatToggleSet = { declared: Toggle[]; sources: ToggleSource[]; value: (key: string) => string | null };

export function togglesOf(store: Reader['store'], chat: Chat, prompt: PromptChoice): ChatToggleSet {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const sources: ToggleSource[] = [
    ...(prompt.kind === 'prompt' ? [{ from: 'prompt' as const, id: prompt.prompt.id, name: prompt.prompt.value.name, lines: prompt.prompt.value.toggles }] : []),
    // packsOf holds only a character or module that is there.
    ...packsOf(store, chat).map(({ id, pack, module }) => ({
      from: module ? ('module' as const) : ('card' as const),
      id,
      name: module ? store.get('module', id)!.value.name : character!.card.name,
      lines: pack.toggles,
    })),
  ];
  const declared = chatToggles(sources.flatMap(({ lines }) => lines));
  return { declared, sources, value:toggleValue(declared, (character ? character.toggles : store.get('settings', SETTINGS_ID)?.value.toggles) ?? {}) };
}

type InspectedToggle = { declaration: Toggle; value: string | null; sources: ToggleSource[] };

export function inspectToggles(store: Reader['store'], chat: Chat): InspectedToggle[] {
  const toggles = togglesOf(store, chat, chatPrompt(store, chat));
  return toggles.declared.map((declaration) => ({
    declaration,
    value: toggles.value(declaration.key),
    sources: toggles.sources.filter(({ lines }) => lines.some((line) => 'key' in line && line.key === declaration.key)),
  }));
}

// null while its 묶음 is missing, which a turn stops on.
export function sentSettings(store: Reader['store'], { connection, model }: Route): ModelSettings | null {
  const profile = modelProfile(store, model);
  if (profile.kind === 'missing') return null;
  const schema = modelSettings(connection.value, model);
  return schema ? fit(schema, profile.profile.value.settings).settings : profile.profile.value.settings;
}

const contextOf = (model: Starred, settings: ModelSettings | null) => settings?.context ?? model.contextLength;
const replyOf = (model: Starred, settings: ModelSettings | null) => settings?.maxOutput ?? model.maxOutput;

function botModel(route: Route, settings: ModelSettings | null): ChatScope['model'] {
  const { connection, model } = route;
  return { id: model.id, maxContext: contextOf(model, settings), prefill: modelSettings(connection.value, model)?.prefill ?? null };
}

export function tokenLimits(model: Starred, settings: ModelSettings | null): TokenLimits {
  return { hard: model.contextLength, user: settings?.context ?? null, output: replyOf(model, settings) ?? 0 };
}

// Authored memory and script allowances retain their o200k meaning; provider fitting uses tokenLimits instead.
// A reply length nobody knows reserves nothing.
export function budgetOf(model: Starred, settings: ModelSettings | null): number | null {
  const context = contextOf(model, settings);
  return context === null ? null : context - (replyOf(model, settings) ?? 0);
}

// The chat's 대화 모델's context and reply lengths as a turn holds them, each null where unknown or no model is set.
export function limitsOf(store: Reader['store'], chat: Chat): { context: number | null; reply: number | null } {
  const route = chatModel(store, chat, 'main');
  if ('kind' in route) return { context: null, reply: null };
  const settings = sentSettings(store, route);
  return { context: contextOf(route.model, settings), reply: replyOf(route.model, settings) };
}

// null when the chat has no 대화 모델 or the context is unknown.
export function promptBudget(store: Reader['store'], chat: Chat): number | null {
  const route = chatModel(store, chat, 'main');
  return 'kind' in route ? null : budgetOf(route.model, sentSettings(store, route));
}

// A chat's messages as a request sends them: under 반전 모드, each with its shown version's translation as its text.
export const asSent = (store: Reader['store'], chat: Chat, messages: Message[]) => (chatTranslate(store, chat).reverse ? messages.map(reversed) : messages);

// A chat as its next request would read it, held open while it is read (시험해 보기); null when it is gone or cannot
// open.
export async function chatNow(session: { store: ObjectStore; read: ReadModels }, chat: string, signal: AbortSignal): Promise<ChatScope | null> {
  const result = await session.store.withChats(
    [chat],
    async (readable) => {
      const stored = live(session.store.get('chat', chat));
      const messages = session.read.chat(chat).snapshot()?.messages;
      return { ok: true, data: readable.length && stored && messages ? scopeOf(session, chat, stored.value, asSent(session.store, stored.value, messages)) : null };
    },
    { signal, summarize: false },
  );
  return result.ok ? result.data : null;
}

// screen: the window the chat is shown in, for a bot's layout; null for what is not shown, such as a preview.
export const evaluateChat = async (reader: { store: Reader['store'] & Pick<ObjectStore, 'evaluation'> }, id: string, chat: Chat, messages: Message[], screen: ChatScope['screen'] = null, signal?: AbortSignal): Promise<Display> =>
  (await reader.store.evaluation.display({ asker: 'headless', chat: id }, { ...scopeOf(reader, id, chat, messages), screen }, pinned(reader, chat), signal)).display;

// Regex indices must match engine/render. Namespace module script ids as <module>:<script>:
// imports reuse regex-0… ids within each pack.
const statusMark = (module: string | null, script: string) => (module === null ? script : `${module}:${script}`);
export const chatScripts = (packs: ReturnType<typeof packsOf>) =>
  packs.flatMap(({ id, pack, module }) => pack.regex.map((script, index) => ({ script, index, module: module && id, mark: statusMark(module && id, script.id) })));

// Retain missing/off script marks for undo and module reactivation, but never extract their boxes.
type StatusScript = { id: string; place: number };
export const statusPlaces = (scripts: ReturnType<typeof chatScripts>, marks: readonly string[]): StatusScript[] =>
  marks.flatMap((id) => {
    const place = scripts.findIndex(({ mark }) => mark === id);
    return place === -1 || scripts[place]!.script.off ? [] : [{ id, place }];
  });

// The status window's scripts (상태창 지정), whose boxes leave every message and what is translated of it, unless
// 봇 스타일 is off; the chat draws the latest box itself.
export function pinned({ store }: Reader, chat: Chat): ReadonlySet<number> {
  const character = chat.character === null ? null : store.get('character', chat.character)?.value;
  return new Set(!character || character.decor === false ? [] : statusPlaces(chatScripts(packsOf(store, chat)), character.statusScripts ?? []).map(({ place }) => place));
}

// A reply still being written is passed over, since half a box would show; so is a box its script left empty, as bots
// do on older messages. null: no message drew one yet.
export type StatusBox = StatusScript & { drawn: (Box & { message: number }) | null };

export function statusBoxes(shown: Display, messages: Shown[], scripts: readonly StatusScript[]): StatusBox[] {
  return scripts.map((script) => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]!.live !== null) continue;
      const box = shown.boxes[index]!.find((each) => each.script === script.place);
      if (box?.html.trim()) return { ...script, drawn: { ...box, message: index } };
    }
    return { ...script, drawn: null };
  });
}

// A reply goes into the switches' replyLanguage and the user's message into their inputLanguage.
export function translationInput(reader: Reader, id: string, chat: Chat, messages: Message[], request: TranslationRequest): TranslateInput {
  const switches = chatTranslate(reader.store, chat);
  const language = request.kind === 'message' ? switches.replyLanguage : switches.inputLanguage;
  return { chat, scope: scopeOf(reader, id, chat, messages), take: pinned(reader, chat), translations: messages.map((message) => shown(message).translation?.text ?? null), request, language, lane: { asker: 'translation', chat: id } };
}

function reversed(message: Message): Message {
  const version = shown(message);
  return version.translation ? { ...message, versions: message.versions.with(message.selected, { ...version, text: version.translation.text }) } : message;
}
