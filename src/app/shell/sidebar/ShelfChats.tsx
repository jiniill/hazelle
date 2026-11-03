import { ChevronLeft, FolderPlus, MessageSquarePlus } from 'lucide-react';
import { useMemo } from 'react';
import { chatFolderOf, type ChatSummary } from '../../../model/chat';
import type { FolderTree } from '../../../model/folders';
import type { Shelf } from '../../../model/library';
import { openCharacter } from '../../chat/characterBeside';
import { ACTS } from '../../common/acts';
import { FolderMenu, named, useMoving, useNaming } from '../../common/folders/FolderParts';
import { useFolderIndex, whereIs } from '../../common/folders/filing';
import { useFolderActions } from '../../common/folders/useFolderActions';
import { useSearch } from '../../common/useSearch';
import { storedStrings, usePersisted } from '../../common/usePersisted';
import { IMPORT_CHATS } from '../../common/words';
import { useImport } from '../../common/importing';
import { ago } from '../../common/time';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useWritingChats } from '../../session';
import { Button, Empty, FolderRow, IconButton, ItemRow, NavRow, Row, SideTitle, Sidebar, TreeRow, Viewport } from '../../ui';
import { navigate, useRoute } from '../router';
import { HOME } from '../routes';
import { LayerButtons } from './LayerButtons';

// Its own key: the character tree's open folders are LibrarySidebar's, and two hooks on one key miss each other's writes.
const OPEN_FOLDERS = 'risu-alpha:open-chat-folders';

type Props = {
  page: boolean;
  shelf: Shelf<ChatSummary>;
};

type ListRow = { key: string; depth: number } & ({ folder: FolderTree } | { chat: ChatSummary });

// Keyed by its character, so the search starts empty in each.
export function ShelfChats({ page, shelf }: Props) {
  const set = useMemo(() => ({ chats: shelf.id }), [shelf.id]);
  const index = useFolderIndex(set, shelf.chats, chatFolderOf);
  const folderActions = useFolderActions(set);
  const naming = useNaming(folderActions);
  const moving = useMoving(set, index, (id) => shelf.chats.find((item) => item.id === id)?.chat.folder ?? null);
  const [openFolders, setOpenFolders] = usePersisted(OPEN_FOLDERS, storedStrings, []);
  const opened = useMemo(() => new Set(openFolders), [openFolders]);
  const { field, found, none, words } = useSearch(shelf.chats, '채팅 검색', (item) => [item.title, item.preview ?? '']);
  const writing = useWritingChats();
  const { pickChats } = useImport();
  const route = useRoute();
  const openChat = route.kind === 'chat' ? route.id : undefined;
  const id = shelf.id;
  // 캐릭터 없이 has a page only beside its chats.
  const open = id !== null ? () => openCharacter(id, !page) : page ? undefined : () => navigate({ kind: 'shelf', character: null });

  const rows = useMemo(() => {
    if (words) return found.map((chat): ListRow => ({ key: chat.id, depth: 0, chat }));
    const result: ListRow[] = [];
    const visit = (folder: FolderTree, depth: number) => {
      result.push({ key: folder.id, depth, folder });
      if (!opened.has(folder.id)) return;
      folder.children.forEach((child) => visit(child, depth + 1));
      index.byFolder.get(folder.id)!.direct.forEach((chat) => result.push({ key: chat.id, depth: depth + 1, chat }));
    };
    index.folders.forEach((folder) => visit(folder, 0));
    index.loose.forEach((chat) => result.push({ key: chat.id, depth: 0, chat }));
    return result;
  }, [words, found, index, opened]);

  const toggleFolder = (folder: string) => setOpenFolders(opened.has(folder) ? openFolders.filter((each) => each !== folder) : [...openFolders, folder]);

  const chatRow = (item: ChatSummary) => {
    const preview = item.preview ?? '미리보기 없음';
    const where = words ? whereIs(index, chatFolderOf(item)) : undefined;
    return (
      <ItemRow
        key={item.id}
        title={item.title}
        time={item.at === null ? '' : ago(item.at)}
        typing={writing.has(item.id)}
        preview={where ? `${where} · ${preview}` : preview}
        current={item.id === openChat}
        selected={moving.picked ? moving.picked.has(item.id) : undefined}
        drag={moving.dropInto && item.id}
        onClick={() => (moving.picked ? moving.toggle(item.id) : navigate({ kind: 'chat', id: item.id }))}
      />
    );
  };

  return (
    <Sidebar
      page={page}
      actions={
        <>
          {/* Wide screens go back by the rail's 캐릭터 둘러보기. */}
          {page && <NavRow icon={ChevronLeft} label="모든 캐릭터" onClick={() => navigate(HOME)} />}
          <SideTitle
            avatar={<ShelfFace shelf={shelf} />}
            name={shelfName(shelf)}
            onOpen={open}
          />
          <Row kind="spread">
            <Button variant="secondary" size="sm" icon={MessageSquarePlus} onClick={() => navigate({ kind: 'new-chat', character: shelf.id })}>
              새 채팅
            </Button>
            {index.folders.length > 0 && moving.button}
            <IconButton icon={FolderPlus} label="새 폴더" size="sm" onClick={() => naming.name({ id: null, name: '' })} />
            <IconButton icon={ACTS.import.icon} label={IMPORT_CHATS} size="sm" onClick={() => pickChats(shelf.id)} />
          </Row>
          {field}
        </>
      }
      corner={<LayerButtons />}
    >
      <Viewport keys={rows.map(({ key }) => key)} current={openChat}>{(slot) => {
        const row = rows[slot]!;
        return (
          <TreeRow depth={row.depth}>
            {'chat' in row ? chatRow(row.chat) : (
              <FolderRow
                name={row.folder.value.name}
                count={index.byFolder.get(row.folder.id)!.inside.length}
                open={opened.has(row.folder.id)}
                onToggle={() => toggleFolder(row.folder.id)}
                menu={<FolderMenu actions={folderActions} folder={named(row.folder)} depth={row.depth + 1} onName={naming.name} />}
                onDropCard={moving.dropInto?.(row.folder.id)}
              />
            )}
          </TreeRow>
        );
      }}</Viewport>
      {shelf.chats.length === 0 ? <Empty variant="side">{`${NO_CHATS}.`}</Empty> : none && <Empty variant="side">{none}</Empty>}
      {moving.bar}
      {naming.dialog}
    </Sidebar>
  );
}
