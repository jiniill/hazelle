import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { chatFolderOf, type ChatSummary } from '../../model/chat';
import type { Shelf } from '../../model/library';
import { foldTerm } from '../../model/search';
import { liveChats, results, type Found } from '../../runtime/chat/chat-search';
import { ACTS } from '../common/acts';
import { describeFailure } from '../common/failure';
import { noResults } from '../common/search';
import { useFolderIndex, whereIs } from '../common/folders/filing';
import { ago } from '../common/time';
import { CHAT_SEARCH } from '../common/words';
import { useLibrary, useSession } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { SHORTCUTS, useShortcut } from '../shortcuts';
import { Callout, Empty, FoundRow, List, NavBar, Screen, SearchField, Stack, Text, type Marked } from '../ui';

// Typing settles this long before the messages are read for it; titles and previews answer every key.
const SETTLE_MS = 300;


type Props = {
  query: string;
  back: Back | null;
  // A character's face and name are the library's to draw, which only the shell composes.
  face: (shelf: Shelf<ChatSummary>) => ReactNode;
  name: (shelf: Shelf<ChatSummary>) => string;
};

export function SearchScreen({ query, back, face, name }: Props) {
  const { finder } = useSession();
  const library = useLibrary();
  const chats = useMemo(() => liveChats(library), [library]);
  const shelves = useMemo(() => new Map([...library.characters, library.none].flatMap((shelf) => shelf.chats.map((chat) => [chat.id, shelf] as const))), [library]);
  const [typed, setTyped] = useState(query);
  const term = foldTerm(typed);
  const [settled, setSettled] = useState(term);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(term), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [term]);
  useEffect(() => finder.find(settled, chats), [settled, chats]);
  useEffect(() => () => finder.stop(), []);
  // Replaced, so 뒤로 from a chat it opened lands on these words, and none of them is a step back of its own.
  useEffect(() => {
    if (typed.trim() !== query) navigate({ kind: 'search', query: typed.trim() }, { replace: true });
  }, [settled]);
  const finding = useSyncExternalStore(finder.subscribe, finder.snapshot);
  const { found, read, unreadable } = useMemo(() => results(chats, term, finding), [chats, term, finding]);

  const field = useRef<HTMLInputElement>(null);
  // Not on the way back from a chat it opened, where a phone's keyboard would cover the results.
  useEffect(() => {
    if (!query) field.current?.focus();
  }, []);
  useShortcut('search', () => {
    field.current?.focus();
    field.current?.select();
  });

  const open = ({ summary, hit }: Found) => navigate({ kind: 'chat', id: summary.id, ...(hit && { find: { term: typed.trim(), at: hit.message } }) });
  const row = (each: Found) => <FoundChat key={each.summary.id} found={each} shelf={shelves.get(each.summary.id)!} face={face} name={name} onOpen={() => open(each)} />;
  const reading = finding.term === term && finding.running;
  const failure = finding.term === term ? finding.failure : null;
  return (
    <Screen width="page" top={<NavBar title={CHAT_SEARCH} {...backBar(back)} />}>
      <Stack gap="related">
        <SearchField ref={field} label={SHORTCUTS.search.label} value={typed} onChange={setTyped} />
        {term && (reading || unreadable > 0) && (
          <Text variant="note">
            {[reading && (finding.filling === null ? `채팅 ${read} / ${chats.length}개 검색하는 중…` : `채팅 받는 중… ${Math.floor(finding.filling * 100)}%`), unreadable > 0 && `읽지 못한 채팅 ${unreadable}개`].filter(Boolean).join(' · ')}
          </Text>
        )}
        {failure && (
          <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => finder.find(settled, chats) }}>
            {describeFailure(failure)}
          </Callout>
        )}
        {found.length > 0 ? (
          <List label={CHAT_SEARCH} keys={found.map(({ summary }) => summary.id)}>
            {(index) => row(found[index]!)}
          </List>
        ) : (
          term && settled === term && !reading && !failure && <Empty>{noResults(typed.trim())}</Empty>
        )}
      </Stack>
    </Screen>
  );
}

type FoundProps = Pick<Props, 'face' | 'name'> & { found: Found; shelf: Shelf<ChatSummary>; onOpen: () => void };

// Its own component so only the rows the list draws index their shelf's chat folders.
function FoundChat({ found: { summary, title, preview, hit }, shelf, face, name, onOpen }: FoundProps) {
  const set = useMemo(() => ({ chats: shelf.id }), [shelf.id]);
  const folder = whereIs(useFolderIndex(set, shelf.chats, chatFolderOf), chatFolderOf(summary));
  const path: Marked[] = [name(shelf), ...(folder ? [folder] : []), title ?? summary.title];
  return (
    <FoundRow
      face={face(shelf)}
      path={path}
      snippet={hit?.lit ?? preview ?? summary.preview}
      note={[hit && `메시지 ${hit.count}개`, summary.at !== null && ago(summary.at)].filter(Boolean).join(' · ')}
      onClick={onOpen}
    />
  );
}
