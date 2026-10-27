import { indexFolders, pathName, pathOf, type Filed, type FolderContents, type FolderIndex, type FolderTree } from '../../../model/folders';
import { PAGES } from '../words';
import { particleOf, withParticle } from '../particles';
import { useFolders } from '../../session';
import { useMemo } from 'react';

const WORDS: Record<Filed, { noun: string; unit: string }> = {
  character: { noun: '캐릭터', unit: '명' },
  prompt: { noun: PAGES.prompts, unit: '개' },
  module: { noun: PAGES.modules, unit: '개' },
  persona: { noun: PAGES.personas, unit: '개' },
};

export const filedNoun = (kind: Filed) => WORDS[kind].noun;
export const filedCount = (kind: Filed, count: number) => `${count}${WORDS[kind].unit}`;
// 캐릭터 3명을, 프롬프트 2개를.
export const filedObject = (kind: Filed, count: number) => `${WORDS[kind].noun} ${filedCount(kind, count)}${particleOf(filedCount(kind, count), '을/를')}`;
export const filedTopic = (kind: Filed) => withParticle(WORDS[kind].noun, '은/는');

export const folderNote = <T>(kind: Filed, { folder, inside }: FolderContents<T>) =>
  [folder.children.length > 0 && `폴더 ${folder.children.length}개`, filedCount(kind, inside.length)].filter(Boolean).join(' · ');

// The folders of a kind other than character with its things filed in them; characters' come with the library.
export function useFolderIndex<T>(kind: Exclude<Filed, 'character'>, items: readonly T[], folderOf: (item: T) => string | null): FolderIndex<T> {
  const folders = useFolders(kind);
  return useMemo(() => indexFolders(items, folders, folderOf), [items, folders, folderOf]);
}

// Missing/stale folders fall back to root. Searching lists all matching items without folder cards.
export type Place<T> = { here: FolderContents<T> | null; path: FolderTree[]; folders: FolderTree[]; placed: (found: readonly T[]) => T[] };

export function placeIn<T>(index: FolderIndex<T>, place: string | null, searching: boolean): Place<T> {
  const here = place === null ? null : (index.byFolder.get(place) ?? null);
  const own = new Set(here ? here.direct : index.loose);
  return {
    here,
    path: here ? pathOf(index.byFolder, here.folder.id) : [],
    folders: searching ? [] : here ? here.folder.children : index.folders,
    placed: (found) => (searching ? [...found] : found.filter((item) => own.has(item))),
  };
}

// The folder path a search result shows before its note, or undefined for one in no folder.
export const whereIs = <T>(index: FolderIndex<T>, folder: string | null) => (folder === null ? undefined : pathName(pathOf(index.byFolder, folder)) || undefined);
