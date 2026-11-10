import type { TogglePreset } from '../../model/prompt';
import type { ApiResult } from '../api';
import type { ToggleSource } from '../chat/chat-context';
import { changePackPresets } from './pack';
import type { ObjectStore } from '../store/store';

// The one that declares the toggles holds their presets, so a fork or a copy takes them along.
export type PresetOwner = Pick<ToggleSource, 'from' | 'id'>;

function changePresets(store: ObjectStore, { from, id }: PresetOwner, change: (presets: TogglePreset[]) => TogglePreset[]): Promise<ApiResult<unknown>> {
  if (from !== 'prompt') return changePackPresets(store, { kind: from === 'card' ? 'character' : 'module', id }, change);
  return store.update('prompt', id, (current) => (current.task === undefined ? { ...current, togglePresets: change(current.togglePresets ?? []) } : null));
}

export const addTogglePreset = (store: ObjectStore, owner: PresetOwner, preset: TogglePreset) => changePresets(store, owner, (presets) => [...presets, preset]);

export const editTogglePreset = (store: ObjectStore, owner: PresetOwner, id: string, patch: Partial<Pick<TogglePreset, 'name' | 'values'>>) =>
  changePresets(store, owner, (presets) => presets.map((preset) => (preset.id === id ? { ...preset, ...patch } : preset)));

export type RemovedPreset = { preset: TogglePreset; at: number };

export async function removeTogglePreset(store: ObjectStore, owner: PresetOwner, id: string): Promise<ApiResult<RemovedPreset>> {
  let removed = null as RemovedPreset | null;
  const done = await changePresets(store, owner, (presets) => {
    const at = presets.findIndex((preset) => preset.id === id);
    removed = at < 0 ? null : { preset: presets[at]!, at };
    return presets.filter((preset) => preset.id !== id);
  });
  if (!done.ok) return done;
  return removed ? { ok: true, data: removed } : { ok: false, error: 'gone' };
}

export const restoreTogglePreset = (store: ObjectStore, owner: PresetOwner, { preset, at }: RemovedPreset) =>
  changePresets(store, owner, (presets) => (presets.some(({ id }) => id === preset.id) ? presets : presets.toSpliced(at, 0, preset)));
