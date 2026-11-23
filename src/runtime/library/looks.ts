import { presetsOf, STARTER_PRESETS, type SavedLook } from '../../model/settings';
import { changeSettings } from '../account-settings';
import type { ObjectStore } from '../store/store';
import { saved } from './saved';

const changeLooks = (store: ObjectStore, change: (looks: SavedLook[]) => SavedLook[]) => changeSettings(store, (current) => ({ ...current, presets: change(presetsOf(current)) }));

// An unread look keeps its place among the rest when another is moved.
export const savedLooks = (store: ObjectStore) => saved<SavedLook>((change) => changeLooks(store, change));

// The starter presets removed from the list, back at its end.
export const addStarters = (store: ObjectStore) => changeLooks(store, (looks) => [...looks, ...STARTER_PRESETS.filter(({ id }) => !looks.some((look) => look.id === id))]);
