import type { TogglePreset } from '../../model/prompt';
import type { ToggleSource } from '../chat/chat-context';
import { changePackPresets } from './pack';
import type { ObjectStore } from '../store/store';
import { saved } from './saved';

// The one that declares the toggles holds their presets, so a fork or a copy takes them along.
export type PresetOwner = Pick<ToggleSource, 'from' | 'id'>;

export const togglePresets = (store: ObjectStore, { from, id }: PresetOwner) =>
  saved<TogglePreset>((change) => {
    if (from !== 'prompt') return changePackPresets(store, { kind: from === 'card' ? 'character' : 'module', id }, change);
    return store.update('prompt', id, (current) => (current.task === undefined ? { ...current, togglePresets: change(current.togglePresets ?? []) } : null));
  });
