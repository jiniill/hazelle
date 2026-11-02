import { SETTINGS_ID, type Settings } from '../model/settings';
import type { ObjectStore } from './store';

// Its own leaf, not a store method or export: readers take a bare Pick<ObjectStore, 'get'>, and a value import of
// store.ts from them closes a cycle (imports.test.ts). Undefined until the first settings write, and again after a
// restore whose backup holds none.
export const accountSettings = (store: Pick<ObjectStore, 'get'>): Settings | undefined => store.get('settings', SETTINGS_ID)?.value;
