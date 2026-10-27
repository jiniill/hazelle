import { filedIn, holds, nest, withInside, type Filed } from '../model/folders';
import type { Stored, Values } from '../model/kinds';
import { without } from '../model/fields';
import { allWritten } from './api';
import { orderFirst } from './characters';
import type { ObjectStore } from './store';

type Placement = { id: string; folder: string | null };

const folderOf = (value: Values[Filed]) => ('folder' in value ? (value.folder ?? null) : null);

// Characters clear folders with null; other kinds omit the field. still fences concurrent moves: keep the newer placement.
function place(store: ObjectStore, kind: Filed, placements: Placement[], still: (folder: string | null) => boolean = () => true) {
  return allWritten(placements.map(({ id, folder }) => {
    if (kind === 'character') return store.update('character', id, (current) => (!still(current.folder) ? current : { ...current, folder }));
    if (kind === 'prompt') return store.update('prompt', id, (current) => (current.task !== undefined || !still(folderOf(current)) ? current : folder === null ? without(current, 'folder') : { ...current, folder }));
    if (kind === 'module') return store.update('module', id, (current) => (!still(folderOf(current)) ? current : folder === null ? without(current, 'folder') : { ...current, folder }));
    return store.update('persona', id, (current) => (!still(folderOf(current)) ? current : folder === null ? without(current, 'folder') : { ...current, folder }));
  }));
}

// A character filed somewhere stands first there (model/order).
export function moveInto(store: ObjectStore, kind: Filed, ids: string[], folder: string | null) {
  const moved = place(store, kind, ids.map((id) => ({ id, folder })));
  return kind === 'character' ? allWritten([moved, orderFirst(store, ids)]) : moved;
}

export const createFolder = (store: ObjectStore, kind: Filed, name: string, parent: string | null) =>
  store.create('folder', { name, ...(parent !== null && { parent }), ...(kind !== 'character' && { of: kind }) });

export const renameFolder = (store: ObjectStore, id: string, name: string) => store.update('folder', id, (current) => ({ ...current, name }));

// What removeFolder writes and restoreFolder undoes, and up, the folder the removed one sat in, where its things move
// to (null: out of every folder).
export type RemovedFolder = { kind: Filed; folders: Stored<'folder'>[]; placements: Placement[]; up: Stored<'folder'> | null };

// Remove the whole subtree atomically with moving its items (including binned ones) up to the parent.
// Dangling folder refs read as unfiled; null means already gone.
export function folderRemoval(store: ObjectStore, id: string): RemovedFolder | null {
  const stored = store.get('folder', id);
  if (!stored) return null;
  const kind = filedIn(stored.value);
  const every = nest(store.list('folder'), kind).flatMap(withInside);
  const target = every.find((folder) => folder.id === id);
  if (!target) return null;
  const up = every.find((folder) => folder.children.includes(target)) ?? null;
  const things: Stored<Filed>[] = store.list(kind);
  const placements = things.filter(({ value }) => holds(target, folderOf(value))).map(({ id, value }) => ({ id, folder: folderOf(value) }));
  return { kind, folders: withInside(target), placements, up };
}

export function removeFolder(store: ObjectStore, { kind, folders, placements, up }: RemovedFolder) {
  const gone = new Set(folders.map(({ id }) => id));
  const moved = place(store, kind, placements.map(({ id }) => ({ id, folder: up?.id ?? null })), (folder) => folder !== null && gone.has(folder));
  return allWritten([moved, store.batch(folders.map(({ id }) => ({ type: 'remove', id })))]);
}

export const restoreFolder = (store: ObjectStore, { kind, folders, placements, up }: RemovedFolder) =>
  allWritten([store.batch(folders.map(({ id, kind, parent, value }) => ({ type: 'restore', id, kind, parent, value }))), place(store, kind, placements, (folder) => folder === (up?.id ?? null))]);
