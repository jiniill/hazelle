import type { Stored } from './kinds';

export type Filed = 'character' | 'prompt' | 'module' | 'persona';

// Folder nesting lives in the sealed body, never the object's cleartext parent.
// Absent of means character for older data; never write 'character' explicitly.
export type Folder = { name: string; parent?: string; of?: Exclude<Filed, 'character'> };
export const FOLDER_DEPTH = 3;
export type FolderTree = Stored<'folder'> & { children: FolderTree[] };

export const filedIn = (folder: Folder): Filed => folder.of ?? 'character';

// Missing parent folders promote children to the root instead of hiding them.
export function nest(folders: Stored<'folder'>[], kind: Filed): FolderTree[] {
  const sorted = folders.filter(({ value }) => filedIn(value) === kind).sort((a, b) => a.value.name.localeCompare(b.value.name, 'ko'));
  const ids = new Set(sorted.map((folder) => folder.id));
  const children = new Map<string, Stored<'folder'>[]>();
  for (const folder of sorted) {
    const parent = folder.value.parent;
    if (parent === undefined) continue;
    const group = children.get(parent);
    if (group) group.push(folder);
    else children.set(parent, [folder]);
  }
  const grow = (folder: Stored<'folder'>): FolderTree => ({ ...folder, children: (children.get(folder.id) ?? []).map(grow) });
  return sorted.filter(({ value }) => value.parent === undefined || !ids.has(value.parent)).map(grow);
}

export const withInside = (folder: FolderTree): FolderTree[] => [folder, ...folder.children.flatMap(withInside)];
export const holds = (folder: FolderTree, at: string | null) => at !== null && withInside(folder).some(({ id }) => id === at);

// What a folder holds: direct are the things in the folder itself, inside those in its subfolders too. up: the folder
// it sits in.
export type FolderContents<T> = { folder: FolderTree; up: FolderTree | null; direct: T[]; inside: T[] };
export type FolderIndex<T> = { folders: FolderTree[]; byFolder: ReadonlyMap<string, FolderContents<T>>; loose: T[] };

export function pathOf<T>(byFolder: ReadonlyMap<string, FolderContents<T>>, id: string): FolderTree[] {
  const path: FolderTree[] = [];
  for (let at = byFolder.get(id); at; at = at.up ? byFolder.get(at.up.id) : undefined) path.unshift(at.folder);
  return path;
}

export const pathName = (path: FolderTree[]) => path.map(({ value }) => value.name).join(' › ');

// Preserve input order; missing folder ids leave items unfiled.
export function indexFolders<T>(items: readonly T[], folders: FolderTree[], folderOf: (item: T) => string | null): FolderIndex<T> {
  const byFolder = new Map<string, FolderContents<T>>();
  const holders = new Map<string, FolderContents<T>[]>();
  const file = (folder: FolderTree, up: FolderTree | null) => {
    const contents: FolderContents<T> = { folder, up, direct: [], inside: [] };
    byFolder.set(folder.id, contents);
    for (const { id } of withInside(folder)) {
      const group = holders.get(id);
      if (group) group.push(contents);
      else holders.set(id, [contents]);
    }
    for (const child of folder.children) file(child, folder);
  };
  for (const top of folders) file(top, null);
  const loose: T[] = [];
  for (const item of items) {
    const at = folderOf(item);
    const own = at === null ? undefined : byFolder.get(at);
    if (!own) {
      loose.push(item);
      continue;
    }
    own.direct.push(item);
    for (const holder of holders.get(own.folder.id)!) holder.inside.push(item);
  }
  return { folders, byFolder, loose };
}
