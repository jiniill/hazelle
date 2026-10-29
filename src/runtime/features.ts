import type { Chat } from '../model/chat';
import { FEATURE_LABS, FEATURE_STARTS, FEATURES, type Feature, type FeatureSwitches } from '../model/features';
import { without } from '../model/fields';
import { EMPTY_SETTINGS, labOn, SETTINGS_ID, type Settings } from '../model/settings';
import type { ApiResult } from './api';
import { illustrateSwitches, translateSwitches, type IllustrateSetup, type TranslateSetup } from './characters';
import { chatPrompt } from './prompts';
import type { ObjectStore } from './store';

// A new 캐릭터 없이 chat: what the 공용 layer resolves to when no chat or card of its own sets anything.
export const SHARED_CHAT: Chat = { title: null, character: null, models: {} };

type Features = Record<Feature, boolean>;
type Reader = Pick<ObjectStore, 'get'>;
type Place = Pick<Chat, 'character' | 'prompt' | 'features'>;
export type FeatureOwner = { kind: 'settings' } | { kind: 'prompt' | 'character' | 'chat'; id: string };
// A layer as its switches screen reads it: a chat by its value, since a new one is not stored until its first send.
export type FeatureLayer = { kind: 'prompt' } | { kind: 'character' } | { kind: 'chat'; chat: Place };

// The features a screen lists: an experiment's only while its 실험실 switch is on.
export const availableFeatures = (settings: Pick<Settings, 'labs'> | undefined): Feature[] =>
  FEATURES.filter((feature) => {
    const lab = FEATURE_LABS[feature];
    return lab === undefined || labOn(settings, lab);
  });

// Nearest explicit layer wins; unset uses FEATURE_STARTS. Disabled experiments stay off despite stored overrides.
function decided(store: Reader, layers: (FeatureSwitches | undefined)[]): Features {
  const available = availableFeatures(store.get('settings', SETTINGS_ID)?.value);
  return Object.fromEntries(FEATURES.map((feature) => [feature, available.includes(feature) && (layers.find((layer) => layer?.[feature] !== undefined)?.[feature] ?? FEATURE_STARTS[feature])])) as Features;
}

const settingsLayer = (store: Reader) => store.get('settings', SETTINGS_ID)?.value.features;
const characterLayer = (store: Reader, character: string | null) => (character === null ? undefined : store.get('character', character)?.value.features);
function promptLayer(store: Reader, chat: Pick<Chat, 'prompt'>) {
  const prompt = chatPrompt(store, chat);
  return prompt.kind === 'prompt' ? prompt.prompt.value.features : undefined;
}

export const featuresOf = (store: Reader, chat: Place): Features => decided(store, [chat.features, characterLayer(store, chat.character), promptLayer(store, chat), settingsLayer(store)]);

// 공용's, the farthest layer, which follows nothing.
export const sharedFeatures = (store: Reader): Features => decided(store, [settingsLayer(store)]);

// What a layer that sets nothing reads: the layers past it. A character's is what a new chat of it reads, through the
// default prompt.
export function inherited(store: Reader, layer: FeatureLayer): Features {
  if (layer.kind === 'prompt') return sharedFeatures(store);
  if (layer.kind === 'character') return decided(store, [promptLayer(store, {}), settingsLayer(store)]);
  return featuresOf(store, { ...layer.chat, features: undefined });
}

// The layer one that sets nothing follows: the next one up 공용 → 프롬프트 → 캐릭터 → 채팅, past a chat with no character.
export function above(layer: FeatureLayer): 'settings' | 'prompt' | 'character' {
  if (layer.kind === 'prompt') return 'settings';
  if (layer.kind === 'character') return 'prompt';
  return layer.chat.character ? 'character' : 'prompt';
}

// null clears the layer's entry; a layer left with none drops the field, so it sets nothing.
export function withFeature<T extends { features?: FeatureSwitches }>(current: T, feature: Feature, value: boolean | null): T {
  const features = value === null ? without(current.features ?? {}, feature) : { ...current.features, [feature]: value };
  return Object.keys(features).length ? { ...current, features } : without(current, 'features');
}

export function setFeatureAt(store: ObjectStore, owner: FeatureOwner, feature: Feature, value: boolean | null): Promise<ApiResult<unknown>> {
  const set = <T extends { features?: FeatureSwitches }>(current: T): T => withFeature(current, feature, value);
  if (owner.kind === 'settings') return store.upsert('settings', (current = EMPTY_SETTINGS) => set(current));
  if (owner.kind === 'prompt') return store.update('prompt', owner.id, (current) => (current.task === undefined ? set(current) : current));
  if (owner.kind === 'character') return store.update('character', owner.id, set);
  return store.update('chat', owner.id, set);
}

// A chat's switches with 번역's 기능 off: none runs. A reader with no chat (a card's translation) reads
// translateSwitches.
export function chatTranslate(store: Reader, chat: Place): TranslateSetup {
  const switches = translateSwitches(store, chat.character);
  return featuresOf(store, chat).translate ? switches : { ...switches, replies: false, input: false, reverse: false };
}

export function chatIllustrate(store: Reader, chat: Place): IllustrateSetup {
  const switches = illustrateSwitches(store, chat.character);
  return featuresOf(store, chat).illustrate ? switches : { ...switches, auto: false };
}
