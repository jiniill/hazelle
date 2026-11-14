import { ChevronLeft, FolderInput, FolderPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toggle } from '../../../connectors/values';
import { chatFolderOf, type ChatSummary } from '../../../model/chat';
import type { FolderTree } from '../../../model/folders';
import type { Shelf } from '../../../model/library';
import { openCharacter } from '../../chat/characterBeside';
import { ChatNameDialog, useChatEdits } from '../../chat/ChatEdits';
import { ChatFolderMenu, useChatFolders } from '../../chat/ChatFolderMenu';
import { ACTS, newOf } from '../../common/acts';
import { groupCopies, latestFirst, type Copied } from '../../common/copies';
import { FolderMenu, MOVE_TO_FOLDER, named, useMoving, useNaming } from '../../common/folders/FolderParts';
import { useFolderIndex, whereIs } from '../../common/folders/filing';
import { useFolderActions } from '../../common/folders/useFolderActions';
import { useSearch } from '../../common/useSearch';
import { storedStrings, usePersisted } from '../../common/usePersisted';
import { IMPORT_CHATS } from '../../common/words';
import { useImport } from '../../common/importing';
import { ago } from '../../common/time';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useWritingChats } from '../../session';
import { Button, Divider, Empty, FoldButton, FolderRow, IconButton, ItemRow, Menu, MenuItem, NavRow, Row, SideTitle, Sidebar, Tabs, TreeRow, useMenuHandle, Viewport } from '../../ui';
import { navigate, useRoute } from '../router';
import { HOME } from '../routes';
import { LayerButtons } from './LayerButtons';

// Its own key: the character tree's open folders are LibrarySidebar's, and two hooks on one key miss each other's writes.
const OPEN_FOLDERS = 'risu-alpha:open-chat-folders';
const OPEN_GROUPS = 'risu-alpha:open-chat-groups';

// A branch (여기서 분기) or a copy hangs under the chat it came from.
const CHAT: Copied<ChatSummary> = { id: (item) => item.id, origin: (item) => item.chat.origin?.id, folder: chatFolderOf };

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
  const edits = useChatEdits();
  const moving = useMoving(set, index, (id) => shelf.chats.find((item) => item.id === id)?.chat.folder ?? null, {
    remove: (ids) => edits.drop(shelf.chats.filter((chat) => ids.includes(chat.id)).map(({ id, title }) => ({ id, title, character: shelf.id }))),
    compact: true,
  });
  const [openFolders, setOpenFolders] = usePersisted(OPEN_FOLDERS, storedStrings, []);
  const [openGroups, setOpenGroups] = usePersisted(OPEN_GROUPS, storedStrings, []);
  const chatMenu = useMenuHandle();
  const folderMenu = useMenuHandle();
  const chatFolders = useChatFolders(shelf.id);
  const [asked, setAsked] = useState<{ chat: ChatSummary; at?: { x: number; y: number } } | null>(null);
  const [renaming, setRenaming] = useState<ChatSummary | null>(null);
  const [starredOnly, setStarredOnly] = useState(false);
  const starred = useMemo(() => shelf.chats.filter(({ chat }) => chat.starred), [shelf.chats]);
  // With the last star gone its filter goes too, at once and for the next star: the list is whole again.
  const onlyStarred = starredOnly && starred.length > 0;
  useEffect(() => {
    if (!starred.length) setStarredOnly(false);
  }, [starred.length]);
  const opened = useMemo(() => new Set(openFolders), [openFolders]);
  const unfolded = useMemo(() => new Set(openGroups), [openGroups]);
  const grouped = useMemo(() => groupCopies(shelf.chats, CHAT), [shelf.chats]);
  const { field, found, none, words } = useSearch(onlyStarred ? starred : shelf.chats, '이 목록에서 검색', (item) => [item.title, item.preview ?? '']);
  const writing = useWritingChats();
  const { pickChats } = useImport();
  const route = useRoute();
  const openChat = route.kind === 'chat' ? route.id : undefined;
  const id = shelf.id;
  // 캐릭터 없이 has a page only beside its chats.
  const open = id !== null ? () => openCharacter(id, !page) : page ? undefined : () => navigate({ kind: 'shelf', character: null });

  // Searched or starred only, the chats found stand alone, each saying its folder.
  const sought = Boolean(words) || onlyStarred;
  // Those and picking several keep every chat in its own place, so each can be found and picked.
  const flat = sought || moving.picked !== null;
  const rows = useMemo(() => {
    if (sought) return found.map((chat): ListRow => ({ key: chat.id, depth: 0, chat }));
    const result: ListRow[] = [];
    const latest = latestFirst(CHAT, (item) => item.at, grouped.copies);
    const top = new Set(grouped.top);
    // A chat with branches stands where its latest branch would, its branches under it while unfolded.
    const hang = (chat: ChatSummary, depth: number) => {
      result.push({ key: chat.id, depth, chat });
      if (unfolded.has(chat.id)) (grouped.copies.get(chat.id) ?? []).toSorted(latest).forEach((copy) => hang(copy, depth + 1));
    };
    const place = (chats: readonly ChatSummary[], depth: number) => {
      if (flat) chats.forEach((chat) => result.push({ key: chat.id, depth, chat }));
      else chats.filter((chat) => top.has(chat)).toSorted(latest).forEach((chat) => hang(chat, depth));
    };
    const visit = (folder: FolderTree, depth: number) => {
      result.push({ key: folder.id, depth, folder });
      if (!opened.has(folder.id)) return;
      folder.children.forEach((child) => visit(child, depth + 1));
      place(index.byFolder.get(folder.id)!.direct, depth + 1);
    };
    index.folders.forEach((folder) => visit(folder, 0));
    place(index.loose, 0);
    return result;
  }, [sought, found, index, opened, grouped, unfolded, flat]);

  const listed = useMemo(() => rows.flatMap((row) => ('chat' in row ? [row.chat.id] : [])), [rows]);
  const toggleFolder = (folder: string) => setOpenFolders(toggle(openFolders, folder));
  const toggleGroup = (chat: string) => setOpenGroups(toggle(openGroups, chat));

  const chatRow = (item: ChatSummary) => {
    const preview = item.preview ?? '미리보기 없음';
    const where = sought ? whereIs(index, chatFolderOf(item)) : undefined;
    const hung = flat ? 0 : (grouped.copies.get(item.id)?.length ?? 0);
    return (
      <ItemRow
        key={item.id}
        title={item.title}
        time={item.at === null ? '' : ago(item.at)}
        typing={writing.has(item.id)}
        starred={item.chat.starred && ACTS.star.label}
        preview={where ? `${where} · ${preview}` : preview}
        current={item.id === openChat}
        selected={moving.picked ? moving.picked.has(item.id) : undefined}
        control={hung > 0 && <FoldButton open={unfolded.has(item.id)} onToggle={() => toggleGroup(item.id)} noun="분기·사본" count={hung} brief />}
        drag={moving.dropInto && item.id}
        onDropCard={sought ? undefined : moving.dropInto?.(chatFolderOf(item))}
        menu={moving.picked ? undefined : { handle: chatMenu, onOpen: () => setAsked({ chat: item, at: chatMenu.read().at }) }}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey) moving.toggle(item.id);
          else if (event.shiftKey) moving.range(item.id, listed);
          else if (moving.picked) moving.toggle(item.id);
          else navigate({ kind: 'chat', id: item.id });
        }}
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
            <Button variant="secondary" size="sm" icon={ACTS.newChat.icon} onClick={() => navigate({ kind: 'new-chat', character: shelf.id })}>
              {ACTS.newChat.label}
            </Button>
            {moving.button}
            <IconButton icon={FolderPlus} label={newOf('폴더')} size="sm" onClick={() => naming.name({ id: null, name: '' })} />
            <IconButton icon={ACTS.import.icon} label={IMPORT_CHATS} size="sm" onClick={() => pickChats(shelf.id)} />
          </Row>
          {field}
          {starred.length > 0 && (
            <Tabs
              label="채팅 보기"
              items={[{ value: 'all', label: '전체' }, { value: 'starred', label: ACTS.star.label }]}
              value={onlyStarred ? 'starred' : 'all'}
              onChange={(tab) => setStarredOnly(tab === 'starred')}
            />
          )}
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
      <Menu handle={chatMenu} label="채팅 메뉴" trigger={() => null}>
        {asked && (
          <>
            <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setRenaming(asked.chat)} />
            <MenuItem icon={ACTS.star.icon} label={ACTS.star.label} checked={asked.chat.chat.starred ?? false} multiple onClick={() => edits.star(asked.chat)} />
            <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void edits.duplicate(asked.chat)} />
            {index.folders.length > 0 && <MenuItem icon={FolderInput} label={MOVE_TO_FOLDER} onClick={() => folderMenu.set({ open: true, from: null, at: asked.at })} />}
            <Divider variant="menu" />
            <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => edits.drop([{ id: asked.chat.id, title: asked.chat.title, character: shelf.id }])} />
          </>
        )}
      </Menu>
      {asked && index.folders.length > 0 && <ChatFolderMenu handle={folderMenu} chat={asked.chat.id} folder={chatFolderOf(asked.chat)} folders={chatFolders} />}
      {renaming && (
        <ChatNameDialog
          title={renaming.title}
          origin={renaming.chat.origin !== undefined}
          onSave={(name) => {
            edits.rename(renaming.id, name);
            setRenaming(null);
          }}
          onClose={() => setRenaming(null)}
        />
      )}
      {moving.bar}
      {naming.dialog}
    </Sidebar>
  );
}
