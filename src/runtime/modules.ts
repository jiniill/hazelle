import type { ImportedModule, Profiles, Unsupported } from '../engine/import/types';
import { likenessId } from '../model/likeness';
import type { Stored } from '../model/kinds';
import { live, type Module } from '../model/library';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { without } from '../model/fields';
import { markDeleted } from './removal';
import { saveAssets, type Progress } from './characters';
import type { Files } from './files';
import { importedLore } from './lore';
import type { StoredPrompt } from './prompts';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';

// Save pictures first, then owned rows and module last so only whole modules become visible.
// brought maps exported Risu/module ids to saved ids already activated by a move.
export async function importModule(store: ObjectStore, files: Files, imported: ImportedModule & { likeness?: Profiles | null }, progress: Progress, brought?: { id: string; risu: string }): Promise<ApiResult<{ id: string; unsupported: Unsupported }>> {
  const stored = await saveAssets(files, imported.assets, progress);
  if (!stored.ok) return stored;
  const id = brought?.id ?? crypto.randomUUID();
  const { folders, writes: lore } = importedLore(id, imported.lore, imported.loreFolders);
  const { name, description, namespace } = imported;
  const module: Module = { ...imported.pack, name, description, namespace, loreFolders: folders, ...(brought && { risu: brought.risu }) };
  const writes: Write[] = [
    { type: 'create', kind: 'module', id, parent: null, value: module },
    ...stored.data.kept.map((asset): Write => ({ type: 'create', kind: 'asset', id: crypto.randomUUID(), parent: id, value: asset })),
    ...lore,
    ...(imported.likeness ? [{ type: 'create' as const, kind: 'likeness' as const, id: likenessId(id), parent: id, value: { ...imported.likeness, receipt: null } }] : []),
  ];
  let done = 0;
  progress({ kind: 'saving', done, total: writes.length });
  const saved = await store.batch(writes, () => progress({ kind: 'saving', done: ++done, total: writes.length }));
  return saved.ok ? { ok: true, data: { id, unsupported: stored.data.unsupported } } : saved;
}

export const modulesOf = (store: Pick<ObjectStore, 'list'>): Stored<'module'>[] =>
  store
    .list('module')
    .filter(({ value }) => value.deleted === undefined)
    .sort((a, b) => a.value.name.localeCompare(b.value.name, 'ko'));

export const switched = (ids: string[] | undefined, id: string, on: boolean) => [...(ids ?? []).filter((each) => each !== id), ...(on ? [id] : [])];

// The live modules a new version of one with this namespace would replace.
export const sameNamespace = (store: Pick<ObjectStore, 'list'>, namespace: string): Stored<'module'>[] => modulesOf(store).filter(({ value }) => value.namespace === namespace);

// id goes just before the first of olds in the list; olds stay in it, off while deleted and on again once restored.
const beside = (ids: string[], id: string, olds: string[]) => {
  const rest = ids.filter((each) => each !== id);
  const at = rest.findIndex((each) => olds.includes(each));
  return at < 0 ? ids : [...rest.slice(0, at), id, ...rest.slice(at)];
};

// Replace olds in every activation list and bin them; retain their positions so restoring olds/deleting the new module
// exactly undoes the replacement. data counts affected places.
export async function replaceModules(store: ObjectStore, id: string, olds: string[]): Promise<ApiResult<number>> {
  const holds = (value: { modules?: string[] } | undefined) => !!value?.modules?.some((each) => olds.includes(each));
  const places: (() => Promise<ApiResult<unknown>>)[] = [
    ...(holds(store.get('settings', SETTINGS_ID)?.value) ? [() => store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, modules: beside(current.modules ?? [], id, olds) }))] : []),
    ...store.list('character').filter(({ value }) => holds(value)).map(({ id: character }) => () => store.update('character', character, (current) => ({ ...current, modules: beside(current.modules ?? [], id, olds) }))),
    ...store.list('persona').filter(({ value }) => holds(value)).map(({ id: persona }) => () => store.update('persona', persona, (current) => ({ ...current, modules: beside(current.modules ?? [], id, olds) }))),
    ...store.list('prompt').filter((prompt): prompt is StoredPrompt<'conversation'> => prompt.value.task === undefined && holds(prompt.value)).map(({ id: prompt }) => () => store.update('prompt', prompt, (current) => (current.task === undefined ? { ...current, modules: beside(current.modules ?? [], id, olds) } : current))),
  ];
  for (const place of [...places, ...olds.map((old) => () => setModuleDeleted(store, old, Date.now()))]) {
    const done = await place();
    if (!done.ok) return done;
  }
  return { ok: true, data: places.length };
}

export const createModule = (store: ObjectStore, name: string, id: string, folder: string | null) =>
  store.create('module', { name, description: '', namespace: null, loreFolders: [], regex: [], triggers: [], toggles: [], ...(folder !== null && { folder }) }, { id });

// The copy keeps the namespace its scripts and pictures are named by, so a later import of the original also offers to
// replace it; risu stays with the original, which a move pairs by it. Its pictures share the original's files.
export function copyModule(store: ObjectStore, id: string, name: string, copy: string): Promise<ApiResult<null>> {
  const original = store.get('module', id)?.value;
  if (!original) return Promise.resolve({ ok: false, error: 'gone' });
  const likeness = store.get('likeness', likenessId(id))?.value;
  const owned = <K extends 'lore' | 'asset'>(kind: K) => store.children(kind, id).map(({ value }): Write => ({ type: 'create', kind, id: crypto.randomUUID(), parent: copy, value }));
  return store.batch([
    { type: 'create', kind: 'module', id: copy, parent: null, value: { ...without(original, 'risu'), name } },
    ...owned('lore'),
    ...owned('asset'),
    ...(likeness ? [{ type: 'create' as const, kind: 'likeness' as const, id: likenessId(copy), parent: copy, value: likeness }] : []),
  ]);
}

export function editModule(store: ObjectStore, id: string, patch: { name?: string; description?: string }): Promise<ApiResult<Stored<'module'>>> {
  return store.update('module', id, (current) => ({ ...current, ...patch }));
}

export function setModuleAlways(store: ObjectStore, id: string, on: boolean): Promise<ApiResult<Stored<'settings'>>> {
  return store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, modules: switched(current.modules, id, on) }));
}

export function setCharacterModule(store: ObjectStore, character: string, id: string, on: boolean): Promise<ApiResult<Stored<'character'>>> {
  return store.update('character', character, (current) => ({ ...current, modules: switched(current.modules, id, on) }));
}

// A task prompt has no modules, so the type takes a conversation prompt only; the sort never changes, so the check
// inside only narrows.
export function setPromptModule(store: ObjectStore, prompt: StoredPrompt<'conversation'>, id: string, on: boolean): Promise<ApiResult<Stored<'prompt'>>> {
  return store.update('prompt', prompt.id, (current) => (current.task === undefined ? { ...current, modules: switched(current.modules, id, on) } : current));
}

// Resolve live Risu modules by id before namespace, deduplicated. Keep unresolved names for later import pairing.
export function companionModules(store: Pick<ObjectStore, 'list'>, names: string[]): { ids: string[]; waiting: string[] } {
  const modules = modulesOf(store);
  const named = (name: string) => modules.find(({ value }) => value.risu === name) ?? modules.find(({ value }) => value.namespace === name);
  return { ids: [...new Set(names.flatMap((name) => named(name)?.id ?? []))], waiting: [...new Set(names.filter((name) => !named(name)))] };
}

// A module arriving after a Risu preset that named it is turned on for that preset's prompts. Its Risu id is the file's:
// a module imported on its own does not store one.
export async function pairWithPrompts(store: ObjectStore, id: string, { risu, namespace }: Pick<ImportedModule, 'risu' | 'namespace'>): Promise<ApiResult<StoredPrompt<'conversation'>[]>> {
  const due = store.list('prompt').filter((prompt): prompt is StoredPrompt<'conversation'> => {
    if (!live(prompt) || prompt.value.task !== undefined) return false;
    const { companions, modules } = prompt.value;
    return !!companions?.some((name) => name === risu || name === namespace) && !modules?.includes(id);
  });
  for (const prompt of due) {
    const set = await setPromptModule(store, prompt, id, true);
    if (!set.ok) return set;
  }
  return { ok: true, data: due };
}

export function setPersonaModule(store: ObjectStore, persona: string, id: string, on: boolean): Promise<ApiResult<Stored<'persona'>>> {
  return store.update('persona', persona, (current) => ({ ...current, modules: switched(current.modules, id, on) }));
}

export type ModulePlace = { kind: 'always' } | { kind: 'character'; id: string } | { kind: 'prompt'; prompt: StoredPrompt<'conversation'> } | { kind: 'persona'; id: string };

export function setModuleAt(store: ObjectStore, place: ModulePlace, id: string, on: boolean): Promise<ApiResult<unknown>> {
  if (place.kind === 'always') return setModuleAlways(store, id, on);
  if (place.kind === 'character') return setCharacterModule(store, place.id, id, on);
  if (place.kind === 'persona') return setPersonaModule(store, place.id, id, on);
  return setPromptModule(store, place.prompt, id, on);
}

// Binning disables every use but preserves activation for undo; purging blocks restoration and removes owned data.
export const setModuleDeleted = (store: ObjectStore, id: string, at: number | null) => markDeleted(store, 'module', id, at);
