import { useMemo } from 'react';
import { indexFolders } from '../../model/folders';
import { FolderChoices, MOVE_TO_FOLDER } from '../common/folders/FolderParts';
import { useFolderActions } from '../common/folders/useFolderActions';
import { useFolders } from '../session';
import { Menu, type MenuHandle } from '../ui';

// A chat's folders are its character's (null: 캐릭터 없이).
export function useChatFolders(character: string | null) {
  const set = useMemo(() => ({ chats: character }), [character]);
  const folders = useFolders(set);
  const index = useMemo(() => indexFolders<never>([], folders, () => null), [folders]);
  return { set, index };
}

type Props = { handle: MenuHandle; chat: string; folder: string | null; folders: ReturnType<typeof useChatFolders> };

// No button of its own: it opens from the header's ⋯ (ChatHeaderActions).
export function ChatFolderMenu({ handle, chat, folder, folders }: Props) {
  const { move } = useFolderActions(folders.set);
  return (
    <Menu handle={handle} place="below-end" label={MOVE_TO_FOLDER} trigger={() => null}>
      <FolderChoices
        index={folders.index}
        onPick={(to) => {
          if ((to?.id ?? null) !== folder) move([chat], to && { id: to.id, name: to.value.name });
        }}
      />
    </Menu>
  );
}
