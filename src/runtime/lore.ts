import { DEFAULT_ORDER } from '../engine/import/convert';
import type { Card, LoreEntry } from '../engine/import/types';
import type { Stored } from '../model/kinds';
import type { Lore, LoreFolder, LoreOwner } from '../model/library';
import { allWritten, type ApiResult } from './api';
import type { Write } from './object-writes';
import type { ObjectStore } from './store';

const newLore = (siblings: Lore[], folder: string | null): Lore => ({
  name: '',
  keys: [],
  secondaryKeys: [],
  content: '',
  enabled: true,
  constant: false,
  selective: false,
  useRegex: false,
  caseSensitive: false,
  insertionOrder: siblings.length ? Math.max(...siblings.map((entry) => entry.insertionOrder)) + 1 : DEFAULT_ORDER,
  priority: null,
  position: null,
  folder,
});

// id: the caller's, so the screen knows the entry before it is stored.
export const addLore = (store: ObjectStore, owner: string, folder: string | null, id: string): Promise<ApiResult<Stored<'lore'>>> =>
  store.create('lore', newLore(store.children('lore', owner).map(({ value }) => value), folder), { id, parent: owner });

// Only the fields given, so an edit to another field on another device survives.
export const editLore = (store: ObjectStore, id: string, patch: Partial<Lore>): Promise<ApiResult<Stored<'lore'>>> =>
  store.update('lore', id, (current) => ({ ...current, ...patch }));

// Lore has no 휴지통: it goes at once, and the toast's 되돌리기 writes it back under its id.
export const removeLore = (store: ObjectStore, id: string) => store.take('lore', id);
export const restoreLore = (store: ObjectStore, removed: Stored<'lore'>) => store.restore(removed);

// Upsert chat lore by name, but keep the first match's id/folder so script writes do not undo user placement.
export function upsertChatLore(store: ObjectStore, chat: string, entry: Omit<Lore, 'folder'>): Promise<ApiResult<null>> {
  const [first, ...rest] = store.children('lore', chat).filter(({ value }) => value.name === entry.name);
  return allWritten([
    first ? store.update('lore', first.id, (current) => ({ ...entry, folder: current.folder })) : store.create('lore', { ...entry, folder: null }, { parent: chat }),
    ...rest.map(({ id }) => store.take('lore', id)),
  ]);
}

export function importedLore(owner: string, lore: LoreEntry[], names: string[]): { folders: LoreFolder[]; writes: Write[] } {
  const folders = names.map((name) => ({ id: crypto.randomUUID(), name }));
  const writes = lore.map((entry): Write => ({ type: 'create', kind: 'lore', id: crypto.randomUUID(), parent: owner, value: { ...entry, folder: entry.folder === null ? null : folders[entry.folder]!.id } }));
  return { folders, writes };
}

// null follows the account's (chat-context loreScanOf).
export const setCharacterLoreScan = (store: ObjectStore, id: string, change: Partial<Card['loreSettings']>): Promise<ApiResult<Stored<'character'>>> =>
  store.update('character', id, (current) => ({ ...current, card: { ...current.card, loreSettings: { ...current.card.loreSettings, ...change } } }));

function setFolders(store: ObjectStore, { kind, id }: LoreOwner, change: (folders: LoreFolder[]) => LoreFolder[]): Promise<ApiResult<unknown>> {
  switch (kind) {
    case 'character':
      return store.update('character', id, (current) => ({ ...current, loreFolders: change(current.loreFolders) }));
    case 'module':
      return store.update('module', id, (current) => ({ ...current, loreFolders: change(current.loreFolders) }));
    case 'chat':
      return store.update('chat', id, (current) => ({ ...current, loreFolders: change(current.loreFolders ?? []) }));
  }
}

type ImportedLore = { entries: string[]; folders: string[] };

// A lorebook file's entries added after the owner's own, its folders after the owner's. The entries go first: one naming
// a folder not yet written sits in no folder until it is.
export async function importLore(store: ObjectStore, owner: LoreOwner, lore: LoreEntry[], names: string[]): Promise<ApiResult<ImportedLore>> {
  const { folders, writes } = importedLore(owner.id, lore, names);
  const saved = await store.batch(writes);
  if (!saved.ok) return saved;
  const filed = folders.length > 0 ? await setFolders(store, owner, (current) => [...current, ...folders]) : saved;
  return filed.ok ? { ok: true, data: { entries: writes.map(({ id }) => id), folders: folders.map(({ id }) => id) } } : filed;
}

export const undoLoreImport = (store: ObjectStore, owner: LoreOwner, { entries, folders }: ImportedLore) =>
  allWritten([...entries.map((id) => store.take('lore', id)), ...(folders.length > 0 ? [setFolders(store, owner, (current) => current.filter(({ id }) => !folders.includes(id)))] : [])]);

export const addLoreFolder = (store: ObjectStore, owner: LoreOwner, name: string) => setFolders(store, owner, (folders) => [...folders, { id: crypto.randomUUID(), name }]);

export const renameLoreFolder = (store: ObjectStore, owner: LoreOwner, folder: string, name: string) =>
  setFolders(store, owner, (folders) => folders.map((each) => (each.id === folder ? { ...each, name } : each)));

type RemovedLoreFolder = { folder: LoreFolder; at: number; entries: string[] };

const place = (store: ObjectStore, entries: string[], folder: string | null) => allWritten(entries.map((id) => store.update('lore', id, (current) => ({ ...current, folder }))));

// Its entries move out of every folder as it goes. Both go at once: an entry left naming a gone folder sits in no
// folder (model/lore loreGroups). null: the folder is gone.
export function loreFolderRemoval(store: ObjectStore, owner: LoreOwner, id: string): RemovedLoreFolder | null {
  const folders = store.get(owner.kind, owner.id)?.value.loreFolders ?? [];
  const at = folders.findIndex((each) => each.id === id);
  const folder = folders[at];
  if (!folder) return null;
  const entries = store.children('lore', owner.id).filter(({ value }) => value.folder === folder.id).map(({ id }) => id);
  return { folder, at, entries };
}

export const removeLoreFolder = (store: ObjectStore, owner: LoreOwner, { folder, entries }: RemovedLoreFolder) =>
  allWritten([place(store, entries, null), setFolders(store, owner, (folders) => folders.filter((each) => each.id !== folder.id))]);

export const restoreLoreFolder = (store: ObjectStore, owner: LoreOwner, { folder, at, entries }: RemovedLoreFolder) =>
  allWritten([setFolders(store, owner, (folders) => folders.toSpliced(at, 0, folder)), place(store, entries, folder.id)]);
