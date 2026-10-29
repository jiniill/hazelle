import { resolveRole, type Assignment, type ModelRef, type Role } from '../connectors/assignment';
import { embedRoute } from '../connectors/registry';
import { entryOf, type Model, type Starred } from '../connectors/types';
import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { chatPrompt } from './prompts';
import { without } from '../model/fields';
import type { ObjectStore } from './store';

// The chat layer lives in the chat object and the prompt layer in the prompt, which runtime/chat-log and runtime/prompts
// write otherwise; their `models` fields are written only here.

export type Route = { connection: Stored<'connection'>; model: Starred };
// image-only: the model draws and writes no text, so it cannot answer a chat or a task (design §6.6).
export type RouteFailure = { kind: 'no-model' } | { kind: 'model-gone' } | { kind: 'image-only' };

// A model whose output is unknown is not image-only: it is shown as unknown, never refused for it.
export const imageOnly = (model: Pick<Model, 'output'>) => model.output !== null && model.output.includes('image') && !model.output.includes('text');

const writes = (route: Route | RouteFailure): Route | RouteFailure => ('kind' in route || !imageOnly(route.model) ? route : { kind: 'image-only' });

// A missing prompt has no layer; the turn stops on it before the model matters.
export function chatModel(store: Pick<ObjectStore, 'get'>, chat: Chat, role: Role): Route | RouteFailure {
  const prompt = chatPrompt(store, chat);
  const ref = resolveRole(role, [chat.models, ...(prompt.kind === 'prompt' ? [prompt.prompt.value.models] : []), store.get('settings', SETTINGS_ID)?.value.models ?? {}]);
  return ref ? writes(routeOf(store, ref)) : { kind: 'no-model' };
}

// 임베딩 모델 is set in 공용 alone (connectors/assignment ROLES). A model whose connection serves no embeddings is gone
// for this role, as one no longer added is.
export function embedModel(store: Pick<ObjectStore, 'get'>): Route | RouteFailure {
  const ref = store.get('settings', SETTINGS_ID)?.value.models.embed;
  if (!ref) return { kind: 'no-model' };
  const route = routeOf(store, ref);
  return 'kind' in route || embedRoute(route.connection.value, route.model) ? route : { kind: 'model-gone' };
}

// 설정 › 모델's own pick for a role, which no chat or prompt changes: what 번역기 calls with. own is a model picked for one call.
export function sharedModel(store: Pick<ObjectStore, 'get'>, role: Role, own: ModelRef | null = null): Route | RouteFailure {
  const ref = own ?? resolveRole(role, [store.get('settings', SETTINGS_ID)?.value.models ?? {}]);
  return ref ? writes(routeOf(store, ref)) : { kind: 'no-model' };
}

export function taskModel(store: Pick<ObjectStore, 'get'>, chat: Chat, own: ModelRef | undefined): Route | RouteFailure {
  return own ? writes(routeOf(store, own)) : chatModel(store, chat, 'aux');
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

export function setTaskModel(store: ObjectStore, prompt: string, ref: ModelRef | null): Promise<ApiResult<Stored<'prompt'>>> {
  return store.update('prompt', prompt, (current) => (current.task === undefined ? current : ref === null ? without(current, 'model') : { ...current, model: ref }));
}

export function setDefaultModel(store: ObjectStore, role: Role, ref: ModelRef | null): Promise<ApiResult<Stored<'settings'>>> {
  return store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, models: assign(current.models, role, ref) }));
}
