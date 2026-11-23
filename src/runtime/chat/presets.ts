import { refOf, sameModelRef, type ModelRef } from '../../connectors/assignment';
import { entryName } from '../../connectors/types';
import { keepsPromptOut, type Chat } from '../../model/chat';
import { without } from '../../model/fields';
import type { ToggleValues } from '../../model/prompt';
import type { ChatPreset } from '../../model/settings';
import { presetHolds, presetMisses, presetSets, valuesNow, type ToggleNow } from '../../model/toggles';
import { changeSettings } from '../account-settings';
import type { ApiFailure, ApiResult } from '../api';
import { setToggleValues } from '../library/characters';
import { chatPrompt } from '../library/prompts';
import { saved } from '../library/saved';
import { chatModel, routeOf, withMainModel } from '../models/assignment';
import type { ObjectStore } from '../store/store';
import { featuresOf, withFeature } from '../tasks/features';
import { packsOf, sourceRows, togglesOf } from './chat-context';
import { withPrompt, type Own } from './chat-log';

type Read = Parameters<typeof togglesOf>[0];
type Done = { ok: true } | ApiFailure;
export type PresetParts = Omit<ChatPreset, 'id' | 'name'>;

export const chatPresets = (store: ObjectStore) => saved<ChatPreset>((change) => changeSettings(store, (current) => ({ ...current, chatPresets: change(current.chatPresets ?? []) })));

// The toggles a chat's prompt declares, with their values now.
function promptRows(store: Read, chat: Chat): ToggleNow[] {
  const set = togglesOf(store, chat, chatPrompt(store, chat), packsOf(store, chat));
  const source = set.sources.find(({ from }) => from === 'prompt');
  return source ? sourceRows(set, source) : [];
}

// What a chat runs on now, read as it resolves and not from its own layer: one that follows the default prompt, or
// talks on its prompt's model, saves those. lacks: the part without which there is nothing to save.
export type Setup = { model: ModelRef; prompt: string; rows: ToggleNow[]; translate: boolean };

export function chatSetup(store: Read, chat: Chat): Setup | { lacks: 'model' | 'prompt' } {
  const route = chatModel(store, chat, 'main');
  if ('kind' in route) return { lacks: 'model' };
  const prompt = chatPrompt(store, chat);
  const card = chat.character === null ? null : (store.get('character', chat.character)?.value.card ?? null);
  if (prompt.kind === 'missing' || keepsPromptOut(card, chat)) return { lacks: 'prompt' };
  return { model: refOf(route.connection.id, route.model), prompt: prompt.prompt.id, rows: promptRows(store, chat), translate: featuresOf(store, chat).translate };
}

export const partsOf = ({ model, prompt, rows, translate }: Setup): PresetParts => ({ model, prompt, toggles: valuesNow(rows), translate });

// Current: the chat reaches the same four, by whatever road.
export const holds = (setup: Setup, { model, prompt, toggles, translate }: PresetParts) =>
  sameModelRef(setup.model, model) && setup.prompt === prompt && setup.translate === translate && presetHolds(setup.rows, toggles);

// How many of the chat's prompt's toggles stand otherwise than a preset of that prompt has them: what keeps it from
// current while its model, prompt and 번역 are the chat's. None on another prompt, whose toggles are not its.
export const togglesApart = (setup: Setup, { prompt, toggles }: PresetParts) => (setup.prompt === prompt ? presetMisses(setup.rows, toggles) : 0);

// What a preset names, as they are called now. lacks: the one that is gone, its model no longer added or its prompt
// deleted; nothing stands in for it, and a pick refuses.
export function presetNames(store: Pick<ObjectStore, 'get'>, { model, prompt }: PresetParts): { model: string; prompt: string } | { lacks: 'model' | 'prompt' } {
  const route = routeOf(store, model);
  if ('kind' in route) return { lacks: 'model' };
  const chosen = chatPrompt(store, { prompt });
  return chosen.kind === 'missing' ? { lacks: 'prompt' } : { model: entryName(route.model), prompt: chosen.prompt.value.name };
}

type Held = Pick<Chat, 'models' | 'features' | 'sendsPrompt' | Own>;
type Layer = { main: ModelRef | undefined; prompt: string | undefined; sendsPrompt: true | undefined; translate: boolean | undefined };

const withPreset = <T extends Held>(chat: T, character: string | null, { model, prompt, translate }: PresetParts): T => withFeature(withMainModel(withPrompt(chat, character, prompt), model), 'translate', translate);

const layerOf = ({ models, prompt, sendsPrompt, features }: Held): Layer => ({ main: models.main, prompt, sendsPrompt, translate: features?.translate });

// Only what a pick wrote goes back, so what was changed beside it since stays.
function withLayer<T extends Held>(chat: T, { main, prompt, sendsPrompt, translate }: Layer): T {
  const cleared = without(without(withFeature(chat, 'translate', translate ?? null), 'prompt'), 'sendsPrompt');
  return { ...cleared, models: main ? { ...chat.models, main } : without(chat.models, 'main'), ...(prompt !== undefined && { prompt }), ...(sendsPrompt && { sendsPrompt }) };
}

// How a chat takes a change, stored or not yet (app/chat useChatSettings).
export type SetChat = (change: <T extends Held>(chat: T) => T) => Promise<Done>;

// A pick: the chat's own parts as one change, then the preset's prompt's toggle values where toggle values live. If
// those fail the chat is put back, so a preset lands whole or not at all. data: its undo.
export async function pickChatPreset(store: ObjectStore, chat: Chat, preset: PresetParts, setChat: SetChat): Promise<ApiResult<() => Promise<Done>>> {
  if ('lacks' in presetNames(store, preset)) return { ok: false, error: 'gone' };
  const before = layerOf(chat);
  const rows = promptRows(store, withPreset(chat, chat.character, preset));
  const sets = presetSets(rows, preset.toggles);
  const were = valuesNow(rows.filter(({ toggle }) => Object.hasOwn(sets, toggle.key)));
  const setToggles = (values: ToggleValues): Promise<Done> => (Object.keys(values).length ? setToggleValues(store, chat.character, values) : Promise.resolve({ ok: true }));
  const back = () => setChat((current) => withLayer(current, before));

  const taken = await setChat((current) => withPreset(current, chat.character, preset));
  if (!taken.ok) return taken;
  const set = await setToggles(sets);
  if (!set.ok) {
    await back();
    return set;
  }
  return {
    ok: true,
    data: async () => {
      const undone = await back();
      return undone.ok ? setToggles(were) : undone;
    },
  };
}
