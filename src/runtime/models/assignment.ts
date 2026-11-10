import { resolveRole, type Assignment, type ModelRef, type Role } from '../../connectors/assignment';
import { embedRoute } from '../../connectors/registry';
import { entryOf, type Model, type Starred } from '../../connectors/types';
import type { Chat } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import type { Settings } from '../../model/settings';
import type { ApiResult } from '../api';
import { chatPrompt, type PromptChoice } from '../library/prompts';
import { without } from '../../model/fields';
import type { ObjectStore } from '../store/store';
import { accountSettings, changeSettings } from '../account-settings';

// The chat layer lives in the chat object and the prompt layer in the prompt, which runtime/chat/chat-log and runtime/library/prompts
// write otherwise; their `models` fields, and an agent prompt's `model`, are written only here.

export type Route = { connection: Stored<'connection'>; model: Starred };
// image-only: the model draws and writes no text, so it cannot answer a chat or a task (design §6.6).
export type RouteFailure = { kind: 'no-model' } | { kind: 'model-gone' } | { kind: 'image-only' };

// A model whose output is unknown is not image-only: it is shown as unknown, never refused for it.
export const imageOnly = (model: Pick<Model, 'output'>) => model.output !== null && model.output.includes('image') && !model.output.includes('text');

const writes = (route: Route | RouteFailure): Route | RouteFailure => ('kind' in route || !imageOnly(route.model) ? route : { kind: 'image-only' });

const LAYERS = ['chat', 'prompt', 'settings'] as const;
// Where a chat's model for a role was picked: the chat's own, its prompt's (모델 고정) or 공용's; role names another role
// where this one fell back to it. null: none picks one.
export type RolePick = { runs: Route | RouteFailure; from: { layer: (typeof LAYERS)[number]; role: Role } | null };

// A missing prompt sets nothing; the turn stops on it before the model matters.
export function chatRole(store: Pick<ObjectStore, 'get'>, chat: Chat, role: Role): RolePick {
  const prompt = chatPrompt(store, chat);
  const picked = resolveRole(role, [chat.models, prompt.kind === 'prompt' ? prompt.prompt.value.models : {}, accountSettings(store).models]);
  return picked ? { runs: writes(routeOf(store, picked.ref)), from: { layer: LAYERS[picked.layer]!, role: picked.role } } : { runs: { kind: 'no-model' }, from: null };
}

export const chatModel = (store: Pick<ObjectStore, 'get'>, chat: Chat, role: Role): Route | RouteFailure => chatRole(store, chat, role).runs;

// 모델 고정: the prompt whose own 대화 모델 the chat talks on, the chat picking none of its own.
export const pinnedBy = (chat: Pick<Chat, 'models'>, prompt: PromptChoice) => (chat.models.main === undefined && prompt.kind === 'prompt' && prompt.prompt.value.models.main !== undefined ? prompt.prompt : null);

// 임베딩 모델 is set in 공용 alone (connectors/assignment ROLES). A model whose connection serves no embeddings is gone
// for this role, as one no longer added is.
export function embedRole(store: Pick<ObjectStore, 'get'>): RolePick {
  const ref = accountSettings(store).models.embed;
  if (!ref) return { runs: { kind: 'no-model' }, from: null };
  const route = routeOf(store, ref);
  return { runs: 'kind' in route || embedRoute(route.connection.value, route.model) ? route : { kind: 'model-gone' }, from: { layer: 'settings', role: 'embed' } };
}

export const embedModel = (store: Pick<ObjectStore, 'get'>): Route | RouteFailure => embedRole(store).runs;

// 설정 › 모델's own pick for a role, which no chat or prompt changes: what 번역기 calls with. own is a model picked for one call.
export function sharedModel(store: Pick<ObjectStore, 'get'>, role: Role, own: ModelRef | null = null): Route | RouteFailure {
  const ref = own ?? resolveRole(role, [accountSettings(store).models])?.ref;
  return ref ? writes(routeOf(store, ref)) : { kind: 'no-model' };
}

// own: the task's feature's model (번역's and 삽화's in their switches, accountTaskModel for the rest, an agent's in its
// prompt); without one, the chat's 보조 모델, then its 대화 모델.
export function taskModel(store: Pick<ObjectStore, 'get'>, chat: Chat, own: ModelRef | undefined): Route | RouteFailure {
  return own ? writes(routeOf(store, own)) : chatModel(store, chat, 'aux');
}

// 공용's alone, as these tasks' prompts are (runtime/library/prompts memoryPrompt).
const ACCOUNT_TASKS = { memory: 'memoryModel', mascot: 'mascotModel', preread: 'prereadModel' } as const satisfies Record<string, keyof Settings>;
export type AccountTask = keyof typeof ACCOUNT_TASKS;

export const accountTaskModel = (store: Pick<ObjectStore, 'get'>, task: AccountTask): ModelRef | undefined => accountSettings(store)[ACCOUNT_TASKS[task]];

export function setAccountTaskModel(store: ObjectStore, task: AccountTask, ref: ModelRef | null): Promise<ApiResult<Stored<'settings'>>> {
  const field = ACCOUNT_TASKS[task];
  return changeSettings(store, (current) => (ref === null ? without(current, field) : { ...current, [field]: ref }));
}

export function routeOf(store: Pick<ObjectStore, 'get'>, ref: ModelRef): Route | RouteFailure {
  const connection = store.get('connection', ref.connection);
  const model = connection && entryOf(connection.value, ref.model);
  return connection && model ? { connection, model } : { kind: 'model-gone' };
}

export const withMainModel = <T extends Pick<Chat, 'models'>>(chat: T, ref: ModelRef): T => ({ ...chat, models: { ...chat.models, main: ref } });

export function setChatModel(store: ObjectStore, chat: string, ref: ModelRef): Promise<ApiResult<Stored<'chat'>>> {
  return store.update('chat', chat, (current) => withMainModel(current, ref));
}

// null leaves the role to the layer below, or to the role it falls back to.
function assign(models: Assignment, role: Role, ref: ModelRef | null): Assignment {
  return ref === null ? without(models, role) : { ...models, [role]: ref };
}

export function setPromptModel(store: ObjectStore, prompt: string, role: Role, ref: ModelRef | null): Promise<ApiResult<Stored<'prompt'>>> {
  return store.update('prompt', prompt, (current) => (current.task === undefined ? { ...current, models: assign(current.models, role, ref) } : current));
}

export function setAgentModel(store: ObjectStore, prompt: string, ref: ModelRef | null): Promise<ApiResult<Stored<'prompt'>>> {
  return store.update('prompt', prompt, (current) => (current.task !== 'agent' ? current : ref === null ? without(current, 'model') : { ...current, model: ref }));
}

export function setDefaultModel(store: ObjectStore, role: Role, ref: ModelRef | null): Promise<ApiResult<Stored<'settings'>>> {
  return changeSettings(store, (current) => ({ ...current, models: assign(current.models, role, ref) }));
}
