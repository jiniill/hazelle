import { useMemo, useState } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { FolderTree } from '../../../model/folders';
import type { Shelf } from '../../../model/library';
import { storedStrings, usePersisted } from '../../common/usePersisted';
import { useSortedLibrary } from '../../common/characterOrder';
import { useCharacter, useChatSummary, useWritingChats } from '../../session';
import { useWide } from '../../ui';
import { navigate, useRoute } from '../router';
import { enterShelf, onBoard, shelfOf } from '../routes';
import { CharacterTree } from './CharacterTree';
import { ShelfChats } from './ShelfChats';
import { SidebarRail } from './SidebarRail';

const OPEN_FOLDERS = 'risu-alpha:open-folders';

type Props = {
  page: boolean;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
};

// Wide layouts use rail + active character chats, rail alone elsewhere (user, 2026-10-11).
// Phone home is the character list; preserve search/folder state across visits.
export function LibrarySidebar({ page, collapsed, onCollapse }: Props) {
  const { none, folders, byFolder, loose } = useSortedLibrary('own');
  const writing = useWritingChats();
  const route = useRoute();
  const chat = useChatSummary(route.kind === 'chat' ? route.id : null);
  const wide = useWide();
  const [query, setQuery] = useState('');
  const [openFolders, setOpenFolders] = usePersisted(OPEN_FOLDERS, storedStrings, []);

  // The rail keeps every face in one place, 직접 순서 whatever the list shows: folders as the tree shows them, loose ones
  // last. Never recency, which the panel shows (user rulings, 2026-10-04 and 2026-10-19).
  const railShelves = useMemo(() => {
    const result: Shelf<ChatSummary>[] = [];
    const visit = (folder: FolderTree) => {
      folder.children.forEach(visit);
      result.push(...byFolder.get(folder.id)!.direct);
    };
    folders.forEach(visit);
    result.push(...loose, none);
    return result;
  }, [folders, byFolder, loose, none]);

  const here = shelfOf(route, chat?.chat.character);
  const character = useCharacter(here ?? null);
  const current = here === null ? none : (character ?? undefined);
  const typing = (shelf: Shelf<ChatSummary>) => shelf.chats.some((item) => writing.has(item.id));

  // Picking a character goes inside it, even when its latest chat is the page already open.
  const enter = (shelf: Shelf<ChatSummary>) => navigate(enterShelf(shelf, wide));

  const chats = current && <ShelfChats key={current.id ?? 'none'} page={page} shelf={current} />;
  if (page) return chats || (
    <CharacterTree
      typing={typing}
      onEnter={enter}
      query={query}
      onQuery={setQuery}
      openFolders={openFolders}
      onToggleFolder={(id) => setOpenFolders(openFolders.includes(id) ? openFolders.filter((open) => open !== id) : [...openFolders, id])}
    />
  );
  return (
    <>
      <SidebarRail shelves={railShelves} current={current} home={route.kind === 'home' || route.kind === 'gallery'} board={onBoard(route)} typing={typing} onEnter={enter} fold={chats ? { open: !collapsed, onToggle: () => onCollapse(!collapsed) } : undefined} />
      {!collapsed && chats}
    </>
  );
}
