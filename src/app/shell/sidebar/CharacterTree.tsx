import { LayoutGrid } from 'lucide-react';
import { useMemo } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { FolderTree } from '../../../model/folders';
import { characterTexts, type Shelf } from '../../../model/library';
import { ACTS } from '../../common/acts';
import { useSearch } from '../../common/useSearch';
import { ago } from '../../common/time';
import { GuestLine } from '../../common/GuestNotice';
import { TUTORIAL, useTutorials } from '../../common/Tutorial';
import { Welcome } from '../../library/HomeScreen';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useCharacterSort, useSortedLibrary } from '../../common/characterOrder';
import { Button, Empty, FolderRow, ItemRow, Row, Sidebar, Tag, TreeRow, Viewport } from '../../ui';
import { navigate } from '../router';
import { AddMenu } from './AddMenu';
import { LayerButtons } from './LayerButtons';

type Props = {
  typing: (shelf: Shelf<ChatSummary>) => boolean;
  onEnter: (shelf: Shelf<ChatSummary>) => void;
  query: string;
  onQuery: (query: string) => void;
  openFolders: string[];
  onToggleFolder: (id: string) => void;
};

export function CharacterTree({ typing, onEnter, query, onQuery, openFolders, onToggleFolder }: Props) {
  const [sort] = useCharacterSort();
  const { characters, none, folders, byFolder, loose } = useSortedLibrary(sort);
  const empty = characters.length === 0 && none.chats.length === 0;
  const search = useSearch(characters, '캐릭터 검색', ({ character }) => characterTexts(character), { query: [query, onQuery] });
  const { words } = search;
  const opened = useMemo(() => new Set(openFolders), [openFolders]);
  const tutorials = useTutorials();
  const door = !words && tutorials.offered.length > 0 ? 1 : 0;

  const row = (shelf: Shelf<ChatSummary>) => {
    const latest = shelf.chats[0];
    return (
      <ItemRow
        key={shelf.id ?? 'none'}
        avatar={<ShelfFace shelf={shelf} />}
        title={shelfName(shelf)}
        time={latest?.at ? ago(latest.at) : ''}
        typing={typing(shelf)}
        preview={latest ? latest.preview || latest.title : shelf.character ? NO_CHATS : '모델과 대화해요'}
        onClick={() => onEnter(shelf)}
      />
    );
  };
  type TreeItem = { key: string; depth: number } & ({ folder: FolderTree } | { shelf: Shelf<ChatSummary> });
  const items = useMemo(() => {
    const result: TreeItem[] = [];
    const add = (shelf: Shelf<ChatSummary>, depth: number) => result.push({ key: shelf.id ?? 'none', depth, shelf });
    const visit = (folder: FolderTree, depth: number) => {
      result.push({ key: folder.id, depth, folder });
      if (!opened.has(folder.id)) return;
      folder.children.forEach((child) => visit(child, depth + 1));
      byFolder.get(folder.id)!.direct.forEach((shelf) => add(shelf, depth + 1));
    };
    if (words) search.found.forEach((shelf) => add(shelf, 0));
    else { folders.forEach((folder) => visit(folder, 0)); loose.forEach((shelf) => add(shelf, 0)); add(none, 0); }
    return result;
  }, [words, search.found, folders, loose, none, opened, byFolder]);

  return (
    <Sidebar
      page
      actions={
        <>
          <Row kind="toolbar">
            <AddMenu
              trigger={(opener) => (
                <Button variant="secondary" size="sm" icon={ACTS.create.icon} {...opener}>
                  {ACTS.create.label}
                </Button>
              )}
            />
            <Button variant="secondary" size="sm" icon={LayoutGrid} onClick={() => navigate({ kind: 'gallery', place: null })}>
              캐릭터 둘러보기
            </Button>
          </Row>
          {search.field}
          {!empty && <GuestLine />}
        </>
      }
      corner={<LayerButtons />}
    >
      {empty && <Welcome />}
      {!empty && search.none && <Empty variant="side">{search.none}</Empty>}
      {!empty && <Viewport keys={[...(door ? ['tutorial'] : []), ...items.map(({ key }) => key)]}>{(slot) => {
        if (slot < door) return <ItemRow avatar={<Tag tone="accent" icon={TUTORIAL.icon} />} title={TUTORIAL.open} time="" typing={false} preview={tutorials.listed} onClick={tutorials.open} />;
        const item = items[slot - door]!;
        return <TreeRow depth={item.depth}>{'shelf' in item ? row(item.shelf) :
          <FolderRow name={item.folder.value.name} count={byFolder.get(item.folder.id)!.inside.length}
            open={opened.has(item.folder.id)} onToggle={() => onToggleFolder(item.folder.id)} />}</TreeRow>;
      }}</Viewport>}

    </Sidebar>
  );
}
