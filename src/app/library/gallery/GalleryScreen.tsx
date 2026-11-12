import { ArrowUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { ChatSummary } from '../../../model/chat';
import type { Stored } from '../../../model/kinds';
import { characterTexts, KEEP_DAYS, type CharacterShelf, type Shelf } from '../../../model/library';
import { placeIn, whereIs } from '../../common/folders/filing';
import { FolderPath, FolderTile, useMoving, useNaming, type Ordering } from '../../common/folders/FolderParts';
import { useFolderActions } from '../../common/folders/useFolderActions';
import { CHARACTER_SORTS, useCharacterSort, useReorder, useSortedLibrary } from '../../common/characterOrder';
import { TASK_NAMES } from '../../common/prompt-words';
import { useSearch } from '../../common/useSearch';
import { TUTORIAL, useTutorials } from '../../common/Tutorial';
import { BIN, EMPTY_FOLDER, MODEL_SETTINGS, PAGES, searchOf, THINGS } from '../../common/words';
import { useBin } from '../../session';
import { backBar, navigate } from '../../shell/router';
import { BIN_PLACE, type Back } from '../../shell/routes';
import { Avatar, Button, CardGrid, ChoiceGroup, Empty, Hint, IconCard, List, NavBar, Row, Screen, Section } from '../../ui';
import { ShelfFace, shelfName } from '../shelf';
import { binnedCharacter, binnedChat, binnedModule, binnedPersona, binnedProfile, binnedPrompt, useCharacterActions, type Binned } from '../useCharacterActions';
import { aliased } from '../../common/alias';
import { BinnedRow } from './BinnedRow';
import { CharacterCard } from './CharacterCard';
import { PurgeDialog } from './PurgeDialog';
import { useInBin } from './useInBin';
import { ShareDialog } from '../ShareDialog';

// A row of 휴지통 other than a character, under the section it is listed in.
type BinEntry = { section: string; key: string; texts: string[]; render: () => ReactNode };
type Entry = CharacterShelf<ChatSummary> | BinEntry;
const isBinEntry = (entry: Entry): entry is BinEntry => 'section' in entry;

const go = (place: string | null) => navigate({ kind: 'gallery', place });

// place: a folder's id, BIN_PLACE for 휴지통, or null for the top (shell/routes).
export function GalleryScreen({ place, back, lead }: { place: string | null; back: Back | null; lead?: ReactNode }) {
  const [sort, setSort] = useCharacterSort();
  const library = useSortedLibrary(sort);
  const reorder = useReorder(setSort);
  const { characters, none, deleted, deletedChats, byCharacter } = library;
  const bin = useBin();
  const inBin = useInBin();
  const characterActions = useCharacterActions();
  const folderActions = useFolderActions('character');
  const naming = useNaming(folderActions);
  const [purging, setPurging] = useState<Binned | null>(null);
  const [arranging, setArranging] = useState(false);
  const tutorials = useTutorials();

  const binned = place === BIN_PLACE;
  // 휴지통 cannot be moved: there no pick shows and no card drags.
  const moving = useMoving('character', library, (id) => byCharacter.get(id)?.character.folder ?? null, { off: binned || arranging });
  const candidates = binned ? deleted : characters;
  // shelve lists only the deleted chats of a character not deleted, or of none.
  const shelfOf = ({ chat }: ChatSummary): Shelf<ChatSummary> => (chat.character === null ? none : byCharacter.get(chat.character)!);
  const busy = (id: string) => (characterActions.busy?.id === id ? characterActions.busy.label : null);
  const rows = <K extends 'module' | 'prompt' | 'persona' | 'profile'>(section: string, items: Stored<K>[], to: (stored: Stored<K>) => Binned, describe: (stored: Stored<K>) => string | undefined, face?: (stored: Stored<K>) => ReactNode): BinEntry[] =>
    items.map((stored) => {
      const item = to(stored);
      return { section, key: item.id, texts: [item.name], render: () => <BinnedRow key={item.id} item={item} face={face?.(stored)} description={describe(stored)} mark={stored.value} busy={busy(item.id)} actions={characterActions} onPurge={() => setPurging(item)} /> };
    });
  const binEntries: BinEntry[] = binned
    ? [
        ...deletedChats.map((item) => {
          const shelf = shelfOf(item);
          const binnedItem = binnedChat(item);
          return { section: '채팅', key: item.id, texts: [item.title, ...(shelf.character ? characterTexts(shelf.character) : [])], render: () => <BinnedRow key={item.id} item={binnedItem} face={<ShelfFace shelf={shelf} />} description={shelfName(shelf)} mark={item.chat} busy={busy(item.id)} actions={characterActions} onPurge={() => setPurging(binnedItem)} /> };
        }),
        ...rows(PAGES.modules, bin.modules, binnedModule, ({ value }) => value.description.trim() || undefined),
        ...rows(PAGES.prompts, bin.prompts, binnedPrompt, ({ value }) => value.task && `${TASK_NAMES[value.task]} ${PAGES.prompts}`),
        ...rows(PAGES.personas, bin.personas, binnedPersona, () => undefined, ({ value }) => <Avatar face={value.name} image={value.picture} tone="you" />),
        ...rows(MODEL_SETTINGS, bin.profiles, binnedProfile, () => undefined),
      ]
    : [];
  const search = useSearch<Entry>([...candidates, ...binEntries], binned ? searchOf(BIN) : searchOf(THINGS.character.noun), (entry) => (isBinEntry(entry) ? entry.texts : characterTexts(entry.character)));
  // One folder's own characters, and every folder's while searching.
  const at = placeIn(library, binned ? null : place, binned || search.words !== '');
  const found = search.found.filter((entry): entry is CharacterShelf<ChatSummary> => !isBinEntry(entry));
  const shown = binned ? found : at.placed(found);
  const folderCards = binned ? [] : at.folders;
  // One place's own cards have an order; search results from every folder have none.
  const ordering = !binned && search.words === '';
  const door = !binned && place === null && search.words === '' && tutorials.offered.length > 0 ? 1 : 0;
  const characterIds = shown.map(({ id }) => id);
  const folderIds = folderCards.map(({ id }) => id);
  const orderOf = (ids: string[], id: string): Ordering | undefined => {
    if (!ordering) return undefined;
    const rest = ids.filter((each) => each !== id);
    return {
      onPlace: (key, after) => {
        if (key === id || !ids.includes(key)) return;
        const others = ids.filter((each) => each !== key);
        reorder(ids, key, after ? (others[others.indexOf(id) + 1] ?? null) : id);
      },
      first: () => reorder(ids, id, rest[0] ?? null),
      last: () => reorder(ids, id, null),
    };
  };
  const binFound = search.found.filter(isBinEntry);
  const listed = ['채팅', PAGES.modules, PAGES.prompts, PAGES.personas, MODEL_SETTINGS].map((title) => [title, binFound.filter(({ section }) => section === title)] as const).filter(([, items]) => items.length > 0);
  const { picked, dropInto } = moving;

  return (
    <Screen width="wide" top={back && <NavBar title="캐릭터" {...backBar(back)} />}>
      {lead}
      <Row kind="toolbar">
        {search.field}
        {!binned && <ChoiceGroup label="정렬" showLabel layout="fit" options={[...CHARACTER_SORTS]} value={sort} onChange={setSort} />}
        {!binned && !picked && (
          <Button variant="secondary" size="sm" icon={ArrowUpDown} onClick={() => setArranging(!arranging)}>
            {arranging ? '완료' : '순서 바꾸기'}
          </Button>
        )}
        {moving.button}
      </Row>
      <FolderPath kind="character" path={at.path} onGo={go} onName={naming.name} dropInto={dropInto} trail={binned ? { key: BIN_PLACE, name: BIN, onClick: () => go(BIN_PLACE) } : undefined}>
        {binned ? (
          <Hint label={BIN}>{`${BIN}에 있는 항목은 ${KEEP_DAYS}일이 지나면 영구 삭제돼요.`}</Hint>
        ) : (
          inBin > 0 && (
            <Button variant="ghost" size="sm" onClick={() => go(BIN_PLACE)}>
              {`${BIN} ${inBin}`}
            </Button>
          )
        )}
      </FolderPath>
      {folderCards.length + shown.length > 0 && (
        <CardGrid label="캐릭터" keys={[...(door ? ['tutorial'] : []), ...folderCards.map(({ id }) => id), ...shown.map(({ id }) => id)]}>
          {(slot) => {
            if (slot < door) return <IconCard icon={TUTORIAL.icon} name={TUTORIAL.open} note={tutorials.listed} onClick={tutorials.open} />;
            const index = slot - door;
            if (index < folderCards.length) {
              const contents = library.byFolder.get(folderCards[index]!.id)!;
              const faces = contents.inside.slice(0, 4).map(({ face, character }) => ({ image: face, name: aliased(character.card.name, character.alias) }));
              return <FolderTile key={contents.folder.id} kind="character" contents={contents} depth={at.path.length + 1} faces={faces} onOpen={() => arranging || go(contents.folder.id)} onName={arranging ? undefined : naming.name} dropInto={dropInto} order={orderOf(folderIds, contents.folder.id)} drag={dropInto !== undefined && ordering} arranging={arranging} />;
            }
            const shelf = shown[index - folderCards.length]!;
            return (
            <CharacterCard
              key={shelf.id}
              shelf={shelf}
              binned={binned}
              busy={busy(shelf.id)}
              picked={picked && picked.has(shelf.id)}
              onPick={() => moving.toggle(shelf.id)}
              actions={characterActions}
              onPurge={() => setPurging(binnedCharacter(shelf))}
              drag={dropInto !== undefined}
              order={orderOf(characterIds, shelf.id)}
              arranging={arranging}
              where={search.words ? whereIs(library, shelf.character.folder) : undefined}
            />
            );
          }}
        </CardGrid>
      )}
      {listed.map(([title, items]) => (
        <Section key={title} title={title}>
          <List label={`${BIN}의 ${title}`} keys={items.map(({ key }) => key)}>{(index) => items[index]!.render()}</List>
        </Section>
      ))}
      {folderCards.length + shown.length === 0 && listed.length === 0 && (
        <Empty>{search.none ?? (binned ? '삭제한 항목이 없어요.' : at.here ? EMPTY_FOLDER : '캐릭터가 없어요.')}</Empty>
      )}
      {moving.bar}
      {purging && (
        <PurgeDialog
          what={purging.what}
          onClose={() => setPurging(null)}
          onPurge={() => {
            setPurging(null);
            void characterActions.purge(purging);
          }}
        />
      )}
      {characterActions.sharing && (
        <ShareDialog character={characterActions.sharing.id} name={characterActions.sharing.character.card.name} onClose={characterActions.stopSharing} />
      )}
      {naming.dialog}
    </Screen>
  );
}
