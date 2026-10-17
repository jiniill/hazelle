import type { ImportedModule, Profiles, Unsupported } from '../engine/import/types';
import { likenessId } from '../model/likeness';
import type { Stored } from '../model/kinds';
import { live, type Module } from '../model/library';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { markDeleted } from './removal';
import { saveAssets, type Progress } from './characters';
import type { Files } from './files';
import { importedLore } from './lore';
import type { StoredPrompt } from './prompts';
import type { ObjectStore } from './store';
import type { Write } from './object-writes';

// A module as the importer read it (design §6.5). Its pictures are stored first; then it is written with its lorebook,
// assets and 삽화 profiles in one batch, itself last, so a module appears only once whole. brought: the id module files
// name it by (a move from Risu's, or a charx bundling it) and the id it is saved at, which a move already turned on.
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

// A new version takes over from olds: it is on, in their place, everywhere one of them is on, and they go to 휴지통.
// Restoring them (setModuleDeleted null) and deleting it undoes this exactly. data: how many places it took over.
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

// A Risu preset names its modules by Risu id or namespace (Risu matches either), the id first. Only live ones: a name no
// module here answers waits for one imported later (pairWithPrompts), and is listed in waiting as written. One named
// twice is on once.
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

// at is when it was deleted: it is off everywhere at once, and removed for good with what it owns KEEP_DELETED later
// (purgeExpired); null brings it back as it was, on where it was on, unless its removal has begun ('gone').
export const setModuleDeleted = (store: ObjectStore, id: string, at: number | null) => markDeleted(store, 'module', id, at);
