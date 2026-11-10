import { FOLDER_DEPTH, kindOf, type FolderSet } from '../../../model/folders';
import { createFolder, filingOf, folderRemoval, moveBack, moveInto, removeFolder, renameFolder, restoreFolder } from '../../../runtime/library/folders';
import { useStore } from '../../session';
import { useToast } from '../../toast';
import type { NamedFolder } from './FolderParts';
import { filedObject, filedTopic } from './filing';

export function useFolderActions(set: FolderSet) {
  const store = useStore();
  const toast = useToast();
  const kind = kindOf(set);

  function create(name: string, parent: string | null) {
    toast.settled(createFolder(store, set, name, parent));
  }

  function rename(id: string, name: string) {
    toast.settled(renameFolder(store, id, name));
  }

  function remove(folder: NamedFolder) {
    const removal = folderRemoval(store, folder.id);
    if (!removal) return false;
    toast.settled(removeFolder(store, removal));
    const { folders: gone, up } = removal;
    const inside = gone.length > 1 ? `와 안의 폴더 ${gone.length - 1}개` : '';
    toast.undoable(
      `'${folder.name}' 폴더${inside}를 삭제했어요.`,
      () => restoreFolder(store, removal),
      `${filedTopic(kind)} ${up ? `'${up.value.name}' 폴더로` : '폴더 밖으로'} 옮겼어요.`,
    );
    return true;
  }

  // to: a folder, or null for out of every folder. shown: how many the user moved, where ids carry more along.
  function move(ids: string[], to: { id: string; name: string } | null, shown = ids.length) {
    const [filing, folder] = [filingOf(store, kind, ids), to?.id ?? null];
    toast.settled(moveInto(store, kind, ids, folder));
    toast.undoable(to ? `${filedObject(kind, shown)} '${to.name}' 폴더로 옮겼어요.` : `${filedObject(kind, shown)} 폴더에서 뺐어요.`, () => moveBack(store, filing, folder));
  }

  return { deepest: FOLDER_DEPTH, create, rename, remove, move };
}
