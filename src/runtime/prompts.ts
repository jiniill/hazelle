import { importPreset, writePreset, type PresetRead } from '../engine/import/preset';
import { illustratorPrompt } from '../engine/illustrate';
import { commentatorPrompt } from '../engine/mascot';
import { memoryTaskPrompt } from '../engine/memory';
import { prereadTaskPrompt } from '../engine/preread';
import { agentPrompt, builtInAgent, type AgentStart } from '../engine/agent';
import { translatorPrompt } from '../engine/translate';
import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live, type Module } from '../model/library';
import { sortOf, type AgentPlace, type Block, type ConversationPrompt, type PictureSettings, type PictureTags, type Prompt, type PromptOf, type PromptSort, type ToggleLine } from '../model/prompt';
import { EMPTY_SETTINGS, labOn, SETTINGS_ID, type LabId, type Settings } from '../model/settings';
import { fromBase64 } from '../vault/aead';
import type { ApiResult } from './api';
import type { BackupOutput } from './backup-zip';
import { writeWhole } from './export-file';
import { companionModules } from './modules';
import type { Write } from './object-writes';
import { markDeleted } from './removal';
import { without } from '../model/fields';
import type { ObjectStore } from './store';

// Every write of `prompt` objects and of the default prompts, except a conversation prompt's `models` layer, which
// runtime/assignment writes with the other layers, and a backup's restore.

// Fixed, so two devices adding a default prompt at once meet in a version conflict instead of making two.
export const STARTER_ID = '00000000-0000-4000-8000-000000000001';
export const TRANSLATOR_ID = '00000000-0000-4000-8000-000000000004';
export const MEMORY_PROMPT_ID = '00000000-0000-4000-8000-000000000005';
export const ILLUSTRATOR_ID = '00000000-0000-4000-8000-000000000006';
export const COMMENTATOR_ID = '00000000-0000-4000-8000-000000000007';
export const PREREADER_ID = '00000000-0000-4000-8000-000000000008';

// Each task's built-in prompt, which a new prompt of its sort starts from while the account's default is gone. An agent
// has no default: a chat runs every agent its lists hold (runtime/agents), each made by addAgent.
type Defaulted = Exclude<PromptSort, 'agent'>;
const BUILT_IN = { translate: translatorPrompt, memory: memoryTaskPrompt, illustrate: illustratorPrompt, mascot: commentatorPrompt, preread: prereadTaskPrompt } satisfies { [S in Exclude<Defaulted, 'conversation'>]: () => PromptOf<S> };

const DEFAULTS = {
  conversation: { setting: 'prompt', id: STARTER_ID, make: starter },
  translate: { setting: 'translatePrompt', id: TRANSLATOR_ID, make: () => Promise.resolve(BUILT_IN.translate()) },
  memory: { setting: 'memoryPrompt', id: MEMORY_PROMPT_ID, make: () => Promise.resolve(BUILT_IN.memory()) },
  illustrate: { setting: 'illustratePrompt', id: ILLUSTRATOR_ID, make: () => Promise.resolve(BUILT_IN.illustrate()) },
  mascot: { setting: 'mascotPrompt', id: COMMENTATOR_ID, make: () => Promise.resolve(BUILT_IN.mascot()) },
  // Added once its 실험실 switch is on (addDefaults), so an account that never turns it on holds none.
  preread: { setting: 'prereadPrompt', id: PREREADER_ID, make: () => Promise.resolve(BUILT_IN.preread()), lab: 'preread' },
} as const satisfies { [S in Defaulted]: { setting: keyof Settings; id: string; make: () => Promise<PromptOf<S> | null>; lab?: LabId } };

export const DEFAULT_PROMPT_IDS: readonly string[] = Object.values(DEFAULTS).map(({ id }) => id);

export type StoredPrompt<S extends PromptSort> = Stored<'prompt'> & { value: PromptOf<S> };
export const ofSort = <S extends PromptSort>(prompt: Stored<'prompt'>, sort: S): prompt is StoredPrompt<S> => sortOf(prompt.value) === sort;

// A deleted one, one of another sort, or a default not added yet reads as missing and never as another prompt; a turn
// stops on it ("기본 프롬프트가 없어요").
export type PromptChoice<S extends PromptSort = 'conversation'> = { kind: 'prompt'; prompt: StoredPrompt<S>; own: boolean } | { kind: 'missing'; own: boolean };

function choose<S extends Defaulted>(store: Pick<ObjectStore, 'get'>, sort: S, chosen: string | undefined): PromptChoice<S> {
  const own = chosen !== undefined;
  const id = chosen ?? store.get('settings', SETTINGS_ID)?.value[DEFAULTS[sort].setting];
  const prompt = id === undefined ? null : live(store.get('prompt', id));
  return prompt && ofSort(prompt, sort) ? { kind: 'prompt', prompt, own } : { kind: 'missing', own };
}

export const chatPrompt = (store: Pick<ObjectStore, 'get'>, chat: Pick<Chat, 'prompt'>) => choose(store, 'conversation', chat.prompt);

export const translationPrompt = (store: Pick<ObjectStore, 'get'>, chosen: string | undefined) => choose(store, 'translate', chosen);

export const memoryPrompt = (store: Pick<ObjectStore, 'get'>) => choose(store, 'memory', undefined);

export const illustrationPrompt = (store: Pick<ObjectStore, 'get'>, chosen: string | undefined) => choose(store, 'illustrate', chosen);

// The account's only: the mascot is on 공용 alone (design §6.11), so no chat or character chooses its own.
export const mascotPrompt = (store: Pick<ObjectStore, 'get'>) => choose(store, 'mascot', undefined);

// The account's only, as the mascot's: 토큰 절약's values are 공용's alone.
export const prereadPrompt = (store: Pick<ObjectStore, 'get'>) => choose(store, 'preread', undefined);

// Place memory last before chat to preserve the fixed cache prefix; tools after chat avoid per-turn invalidation.
// Keep card-replacement text blocks/notes empty but present. Task prompts clone the default or built-in.
// Only conversation prompts may be filed.
export function addPrompt(store: ObjectStore, name: string, sort: Defaulted, id?: string, folder?: string): Promise<ApiResult<Stored<'prompt'>>> {
  const named = () => ({ id: crypto.randomUUID(), name: null });
  if (sort !== 'conversation') {
    const base = choose(store, sort, undefined);
    const { blocks, toggles } = base.kind === 'prompt' ? base.prompt.value : BUILT_IN[sort]();
    return store.create('prompt', { task: sort, name, blocks: blocks.map((block) => ({ ...block, id: crypto.randomUUID() })), toggles }, { id });
  }
  const blocks: Block[] = [
    { ...named(), kind: 'text', role: 'system', text: '', mark: 'main' },
    { ...named(), kind: 'slot', slot: 'description', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'persona', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'lorebook' },
    { ...named(), kind: 'slot', slot: 'memory', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'chat', range: { from: 0, to: null } },
    { ...named(), kind: 'slot', slot: 'tool', role: 'system', wrapper: null },
    { ...named(), kind: 'text', role: 'system', text: '', mark: 'globalNote' },
    { ...named(), kind: 'slot', slot: 'authorNote', role: 'system', wrapper: null },
    { ...named(), kind: 'slot', slot: 'postEverything' },
  ];
  return store.create('prompt', { name, blocks, toggles: [], authorNote: '', models: {}, ...(folder !== undefined && { folder }) }, { id });
}

// An agent starts as a built-in (기본 장면 메모, 기본 문장 다듬기) or empty with its stage's slots (engine/agent).
export const addAgent = (store: ObjectStore, start: AgentStart, name: string) => store.create('prompt', agentPrompt(start, name));

// Save preset-paired/new regex modules with the prompt in one batch. waiting retains unresolved module names.
export async function savePreset(store: ObjectStore, { prompt, regex }: PresetRead): Promise<ApiResult<{ id: string; paired: string[]; waiting: string[]; made: string | null }>> {
  const id = crypto.randomUUID();
  const made = regex.length > 0 ? crypto.randomUUID() : null;
  const companions = companionModules(store, prompt.companions ?? []);
  const paired = [...companions.ids, ...(made ? [made] : [])];
  const module: Module = { name: `${prompt.name} 정규식`.trim(), description: '', namespace: null, regex, triggers: [], toggles: [], loreFolders: [] };
  const writes: Write[] = [
    ...(made ? [{ type: 'create' as const, kind: 'module' as const, id: made, parent: null, value: module }] : []),
    { type: 'create', kind: 'prompt', id, parent: null, value: paired.length > 0 ? { ...prompt, modules: paired } : prompt },
  ];
  const saved = await store.batch(writes);
  return saved.ok ? { ok: true, data: { id, paired, waiting: companions.waiting, made } } : saved;
}

// Its Risu preset file, naming for Risu's moduleIntergration the live modules on for it that have a namespace, the only
// identity a module keeps in Risu. tools: the 도구 blocks left out.
export async function exportPreset(store: Pick<ObjectStore, 'get'>, prompt: ConversationPrompt, output: BackupOutput): Promise<ApiResult<{ tools: number }>> {
  const namespaces = (prompt.modules ?? []).flatMap((id) => live(store.get('module', id))?.value.namespace ?? []);
  const { bytes, tools } = await writePreset(prompt, namespaces);
  const written = await writeWhole(output, bytes);
  return written.ok ? { ok: true, data: { tools } } : written;
}

// Seed each missing sort default once, after experiment opt-in where required. Await on session open; retry next open.
// Merge settings once for all additions because other open-time seeders write them concurrently.
export async function addDefaults(store: ObjectStore): Promise<void> {
  const added = await Promise.all(
    Object.values(DEFAULTS).map(async (entry) => {
      const settings = store.get('settings', SETTINGS_ID)?.value;
      if (settings?.[entry.setting] !== undefined || ('lab' in entry && !labOn(settings, entry.lab))) return [];
      if (store.get('prompt', entry.id)) return [entry];
      const made = await entry.make();
      return made && (await store.create('prompt', made, { id: entry.id })).ok ? [entry] : [];
    }),
  );
  if (added.flat().length === 0) return;
  await store.upsert('settings', (current = EMPTY_SETTINGS) => added.flat().reduce((next, { setting, id }) => (next[setting] === undefined ? { ...next, [setting]: id } : next), current));
}

// The user's own Risu preset, through the one preset converter. It goes out under the app's name, not the preset's:
// the preset's name is a well-known community prompt's.
async function starter(): Promise<ConversationPrompt | null> {
  const read = await importPreset('starter-prompt.risup', await starterBytes());
  return read.ok ? without({ ...read.prompt, name: '기본 대화' }, 'imported') : null;
}

// Vite hands an ?inline asset over as a base64 data: URL, in the browser and in tests alike. It is decoded
// here rather than fetched: the CSP allows no data: requests.
async function starterBytes(): Promise<Uint8Array<ArrayBuffer>> {
  const { default: uri } = await import('./starter-prompt.risup?inline');
  return fromBase64(uri.slice(uri.indexOf(',') + 1));
}

// Merge only supplied fields against the latest copy. Clearing tags restores app defaults; clearing protect removes it;
// clearing post-agent place restores in-place rewriting. Apply fields only to their owning prompt sorts.
export type PromptPatch = Partial<{ name: string; blocks: Block[]; toggles: ToggleLine[]; authorNote: string; tags: PictureTags; picture: PictureSettings; protect: string[]; place: AgentPlace }>;

export const editPrompt = (store: ObjectStore, id: string, patch: PromptPatch) => store.update('prompt', id, (current): Prompt => ({ ...current, ...patch }));

// Reset blocks/toggles only to the current built-in so old stored copies can acquire new slots.
// Keep name/model/origin and illustration tags/settings.
export function resetPromptBlocks(store: ObjectStore, id: string): Promise<ApiResult<Stored<'prompt'>>> {
  const prompt = store.get('prompt', id)?.value;
  if (!prompt || prompt.task === undefined) return Promise.resolve({ ok: false, error: 'gone' });
  const { blocks, toggles } = prompt.task === 'agent' ? builtInAgent(prompt.stage) : BUILT_IN[prompt.task]();
  return editPrompt(store, id, { blocks, toggles });
}

// A fork that goes its own way, model layer and toggles included. It remembers its origin, and is the user's
// own rather than an imported preset, so no module imported later is paired with it.
export function copyPrompt(store: ObjectStore, id: string, name: string, copy?: string): Promise<ApiResult<Stored<'prompt'>>> {
  const original = store.get('prompt', id)?.value;
  if (!original) return Promise.resolve({ ok: false, error: 'gone' });
  const origin = { id, name: original.name };
  return store.create('prompt', original.task === undefined ? without(without({ ...original, name, origin }, 'imported'), 'companions') : { ...original, name, origin }, { id: copy });
}

// To 휴지통 (model/library Mark). A sort's default prompt cannot be deleted until another prompt of its sort is made the
// default.
export async function removePrompt(store: ObjectStore, id: string): Promise<ApiResult<Stored<'prompt'>> | { ok: false; error: 'default' }> {
  const settings = store.get('settings', SETTINGS_ID)?.value;
  if (Object.values(DEFAULTS).some(({ setting }) => settings?.[setting] === id)) return { ok: false, error: 'default' };
  return markDeleted(store, 'prompt', id, Date.now());
}

export const restorePrompt = (store: ObjectStore, id: string) => markDeleted(store, 'prompt', id, null);

export function isDefaultPrompt(settings: Settings, prompt: Stored<'prompt'>) {
  const sort = sortOf(prompt.value);
  return sort !== 'agent' && settings[DEFAULTS[sort].setting] === prompt.id;
}

export function setDefaultPrompt(store: ObjectStore, id: string): Promise<ApiResult<Stored<'settings'>>> {
  const prompt = store.get('prompt', id);
  const sort = prompt && sortOf(prompt.value);
  if (!sort || sort === 'agent') return Promise.resolve({ ok: false, error: 'gone' });
  return store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, [DEFAULTS[sort].setting]: id }));
}
