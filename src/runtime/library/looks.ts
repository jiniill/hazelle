import { moved } from '../../model/fields';
import type { SavedLook } from '../../model/settings';
import { changeSettings } from '../account-settings';
import type { ApiResult } from '../api';
import type { ObjectStore } from '../store/store';

const changeLooks = (store: ObjectStore, change: (looks: SavedLook[]) => SavedLook[]) => changeSettings(store, (current) => ({ ...current, looks: change(current.looks ?? []) }));

export const addLook = (store: ObjectStore, look: SavedLook) => changeLooks(store, (looks) => [...looks, look]);

export const editLook = (store: ObjectStore, id: string, patch: Partial<Pick<SavedLook, 'name' | 'look'>>) =>
  changeLooks(store, (looks) => looks.map((look) => (look.id === id ? { ...look, ...patch } : look)));

export type RemovedLook = { look: SavedLook; at: number };

export async function removeLook(store: ObjectStore, id: string): Promise<ApiResult<RemovedLook>> {
  let removed = null as RemovedLook | null;
  const done = await changeLooks(store, (looks) => {
    const at = looks.findIndex((look) => look.id === id);
    removed = at < 0 ? null : { look: looks[at]!, at };
    return looks.filter((look) => look.id !== id);
  });
  if (!done.ok) return done;
  return removed ? { ok: true, data: removed } : { ok: false, error: 'gone' };
}

export const restoreLook = (store: ObjectStore, { look, at }: RemovedLook) => changeLooks(store, (looks) => looks.toSpliced(at, 0, look));

// The look ends where target was, before it when moved toward the front and after it when moved toward the back; an
// unread look keeps its place among the rest.
export const moveLook = (store: ObjectStore, id: string, target: string) =>
  changeLooks(store, (looks) => {
    const from = looks.findIndex((look) => look.id === id);
    const to = looks.findIndex((look) => look.id === target);
    return from < 0 || to < 0 || from === to ? looks : moved(looks, from, to);
  });
