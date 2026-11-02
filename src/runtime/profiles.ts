import type { ModelRef } from '../connectors/assignment';
import type { ModelSettings } from '../connectors/settings';
import { entryKey, entryName, type Starred } from '../connectors/types';
import type { Chat } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import type { Profile } from '../model/profile';
import { EMPTY_SETTINGS } from '../model/settings';
import type { ApiResult } from './api';
import { imageOnly, taskModel, type Route, type RouteFailure } from './assignment';
import { markDeleted } from './removal';
import { without } from '../model/fields';
import type { ObjectStore } from './store';
import { accountSettings } from './account-settings';

// Every write of `profile` objects, of the default 묶음, and of the 묶음 an added model uses.

// Fixed, so two devices adding the first 묶음 at once meet in a version conflict instead of making two.
export const FIRST_PROFILE_ID = '00000000-0000-4000-8000-000000000003';

// A deleted one, or a default not added yet, reads as missing and never as another 묶음; a turn stops on it, as it
// does on a missing prompt.
export type ProfileChoice = { kind: 'profile'; profile: Stored<'profile'>; own: boolean } | { kind: 'missing'; own: boolean };

const profileId = (model: Starred, defaultProfile: string | undefined) => model.profile ?? defaultProfile;

export function modelProfile(store: Pick<ObjectStore, 'get'>, model: Starred): ProfileChoice {
  const own = model.profile !== undefined;
  const id = profileId(model, accountSettings(store)?.profile);
  const profile = id === undefined ? null : live(store.get('profile', id));
  return profile ? { kind: 'profile', profile, own } : { kind: 'missing', own };
}

// A task prompt's own model, else the chat's 보조, with its 설정 묶음: what a 삽화 scene, a pack's profiles and a mascot's
// line are written by.
export function taskWriter(store: Pick<ObjectStore, 'get'>, chat: Chat, own: ModelRef | undefined): { route: Route; settings: ModelSettings } | RouteFailure | { kind: 'profile-missing'; own: boolean } {
  const route = taskModel(store, chat, own);
  if ('kind' in route) return route;
  const profile = modelProfile(store, route.model);
  return profile.kind === 'missing' ? { kind: 'profile-missing', own: profile.own } : { route, settings: profile.profile.value.settings };
}

// A model that only draws uses no 묶음, whatever it names.
export type ProfileUser = { connection: Stored<'connection'>; model: Starred };
export function profileUsers(connections: readonly Stored<'connection'>[], defaultProfile: string | undefined, id: string): ProfileUser[] {
  return connections.flatMap((connection) => connection.value.starred.filter((model) => !imageOnly(model) && profileId(model, defaultProfile) === id).map((model) => ({ connection, model })));
}

// An account that has never had a default 묶음 gets an empty one, once. The session awaits it when it opens;
// a failure is tried again next time.
// The starter's name, which the default's mark leaves out (words defaultMark).
export const FIRST_PROFILE_NAME = '기본';

export async function addFirstProfile(store: ObjectStore): Promise<void> {
  if (accountSettings(store)?.profile !== undefined) return;
  if (!store.get('profile', FIRST_PROFILE_ID)) {
    const saved = await store.create('profile', { name: FIRST_PROFILE_NAME, settings: {} }, { id: FIRST_PROFILE_ID });
    if (!saved.ok) return;
  }
  await store.upsert('settings', (current = EMPTY_SETTINGS) => (current.profile === undefined ? { ...current, profile: FIRST_PROFILE_ID } : current));
}

export const addProfile = (store: ObjectStore, profile: Profile, id?: string) => store.create('profile', profile, { id });

export const renameProfile = (store: ObjectStore, id: string, name: string) => store.update('profile', id, (current) => ({ ...current, name }));

// A setting given as undefined is cleared: nothing is sent for it.
export function withSettings(settings: ModelSettings, values: ModelSettings): ModelSettings {
  const next = { ...settings, ...values };
  for (const key of Object.keys(next) as (keyof ModelSettings)[]) if (next[key] === undefined) delete next[key];
  return next;
}

// Each change is merged into the current copy on every try, so a field changed meanwhile on another device survives.
export const setProfileSettings = (store: ObjectStore, id: string, values: ModelSettings) =>
  store.update('profile', id, (current) => ({ ...current, settings: withSettings(current.settings, values) }));

// To 휴지통 (model/library Mark). As with prompts, the default goes only once another 묶음 is the default. A model that
// used a deleted 묶음 reads as missing until it is given another, or the 묶음 comes back.
export async function removeProfile(store: ObjectStore, id: string): Promise<ApiResult<Stored<'profile'>> | { ok: false; error: 'default' }> {
  if (accountSettings(store)?.profile === id) return { ok: false, error: 'default' };
  return markDeleted(store, 'profile', id, Date.now());
}

export const restoreProfile = (store: ObjectStore, id: string) => markDeleted(store, 'profile', id, null);

export const setDefaultProfile = (store: ObjectStore, id: string) => store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, profile: id }));

// For an account whose every 모델 설정 was deleted: a new one under the starter's name becomes the default.
export async function addDefaultProfile(store: ObjectStore) {
  const id = crypto.randomUUID();
  const made = await addProfile(store, { name: FIRST_PROFILE_NAME, settings: {} }, id);
  return made.ok ? setDefaultProfile(store, id) : made;
}

// The default 묶음 is what a model without its own uses, so putting a model on it clears the model's own.
export function setModelProfile(store: ObjectStore, connection: string, key: string, profile: string): Promise<ApiResult<Stored<'connection'>>> {
  const isDefault = profile === accountSettings(store)?.profile;
  return store.update('connection', connection, (current) => ({
    ...current,
    starred: current.starred.map((entry) => (entryKey(entry) !== key ? entry : isDefault ? without(entry, 'profile') : { ...entry, profile })),
  }));
}

// Answers the id only once the 설정 exists, so no entry can point at one whose create failed.
export async function ownProfile(store: ObjectStore, entry: Pick<Starred, 'name' | 'label'>, settings: ModelSettings): Promise<ApiResult<string>> {
  const made = await addProfile(store, { name: `${entryName(entry)}용`, settings });
  return made.ok ? { ok: true, data: made.data.id } : made;
}
