import type { ModelRef, Role } from '../../connectors/assignment';
import type { Chat } from '../../model/chat';
import { live } from '../../model/library';
import { pinsModels } from '../../model/prompt';
import { accountTaskModel, chatRole, embedRole, type Route, type RolePick } from '../models/assignment';
import { chatIllustrate, chatTranslate, featuresOf, SHARED_CHAT } from './features';
import { imageRoute, sceneWriterOf, type IllustrateFailure } from './illustrate';
import { mascotWriterOf, type MascotFailure } from './mascot';
import type { MemoryFailure } from './memory';
import { memoryOwner, memoryWriter } from './memory-read';
import { briefWriterOf, type PrereadFailure } from './preread';
import { chatPrompt, ofSort, type PromptChoice, type StoredPrompt } from '../library/prompts';
import type { ObjectStore } from '../store/store';
import { translatorOf, type TranslatorFailure } from './translate';

// 내 구성: what runs on what in one chat, or in 공용 as a new chat with no character reads it. Each model comes from the
// resolver its feature runs on, so this page and the runtime cannot disagree.

type Failures = { translate: TranslatorFailure; illustrate: IllustrateFailure; memory: MemoryFailure; mascot: MascotFailure; preread: Exclude<PrereadFailure, { kind: 'stopped' }> };
export type Task = keyof Failures;
// draws: the image model 삽화 draws with; by: the plugin that keeps the memory, which runs on no model of the chat's.
type Extra = { illustrate: { draws: ReturnType<typeof imageRoute> }; memory: { by: string | null } };
// own: the feature's own model, undefined while it follows 보조 모델. apart: a character's own switches decide it.
export type TaskRun = { [T in Task]: { feature: T; on: boolean; own: ModelRef | undefined; apart: boolean; runs: { route: Route } | Failures[T] } & (T extends keyof Extra ? Extra[T] : unknown) }[Task];

export type Overview = {
  roles: Record<Role, RolePick>;
  // 대화: the chat's prompt; pins, in 공용, the other conversation prompts that talk on a 대화 모델 of their own.
  talk: { prompt: PromptChoice; pins: { prompt: StoredPrompt<'conversation'>; ref: ModelRef }[] };
  tasks: TaskRun[];
};

// chat: null for 공용.
export function overviewOf(store: ObjectStore, chat: Chat | null): Overview {
  const place = chat ?? SHARED_CHAT;
  const on = featuresOf(store, place);
  const translate = chatTranslate(store, place);
  const translator = translatorOf(store, place);
  const illustrate = chatIllustrate(store, place);
  const memory = memoryOwner(store, place);
  const prompt = chatPrompt(store, place);
  const mine = prompt.kind === 'prompt' ? prompt.prompt.id : null;
  const pins = chat
    ? []
    : store.list('prompt').flatMap((each) => (live(each) && each.id !== mine && ofSort(each, 'conversation') && pinsModels(each.value) && each.value.models.main ? [{ prompt: each, ref: each.value.models.main }] : []));
  return {
    roles: { main: chatRole(store, place, 'main'), aux: chatRole(store, place, 'aux'), embed: embedRole(store) },
    talk: { prompt, pins },
    tasks: [
      { feature: 'translate', on: on.translate, own: translate.model, apart: translate.own, runs: translator.ok ? { route: translator.route } : translator.failure },
      { feature: 'illustrate', on: on.illustrate, own: illustrate.sceneModel, apart: illustrate.own, runs: sceneWriterOf(store, place), draws: imageRoute(store, illustrate.model) },
      { feature: 'memory', on: memory !== null, own: accountTaskModel(store, 'memory'), apart: false, runs: memoryWriter(store, place), by: memory?.kind === 'tool' ? memory.unit.tool.manifest.displayName : null },
      { feature: 'mascot', on: on.mascot, own: accountTaskModel(store, 'mascot'), apart: false, runs: mascotWriterOf(store, place) },
      { feature: 'preread', on: on.preread, own: accountTaskModel(store, 'preread'), apart: false, runs: briefWriterOf(store, place) },
    ],
  };
}
