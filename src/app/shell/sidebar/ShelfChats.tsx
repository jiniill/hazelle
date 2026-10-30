import { ChevronLeft, MessageSquarePlus } from 'lucide-react';
import type { ChatSummary } from '../../../model/chat';
import type { Shelf } from '../../../model/library';
import { openCharacter } from '../../chat/characterBeside';
import { ACTS } from '../../common/acts';
import { useSearch } from '../../common/useSearch';
import { IMPORT_CHATS } from '../../common/words';
import { useImport } from '../../common/importing';
import { ago } from '../../common/time';
import { NO_CHATS, ShelfFace, shelfName } from '../../library/shelf';
import { useWritingChats } from '../../session';
import { Button, Empty, IconButton, ItemRow, NavRow, Row, SideTitle, Sidebar, Viewport } from '../../ui';
import { navigate, useRoute } from '../router';
import { HOME } from '../routes';
import { LayerButtons } from './LayerButtons';

type Props = {
  page: boolean;
  shelf: Shelf<ChatSummary>;
};

// Keyed by its character, so the search starts empty in each.
export function ShelfChats({ page, shelf }: Props) {
  const { field, found, none } = useSearch(shelf.chats, '채팅 검색', (item) => [item.title, item.preview ?? '']);
  const writing = useWritingChats();
  const { pickChats } = useImport();
  const route = useRoute();
  const openChat = route.kind === 'chat' ? route.id : undefined;
  const id = shelf.id;
  // 캐릭터 없이 has a page only beside its chats.
  const open = id !== null ? () => openCharacter(id, !page) : page ? undefined : () => navigate({ kind: 'shelf', character: null });
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
            <IconButton icon={ACTS.import.icon} label={IMPORT_CHATS} size="sm" onClick={() => pickChats(shelf.id)} />
          </Row>
          {field}
        </>
      }
      corner={<LayerButtons />}
    >
      <Viewport keys={found.map(({ id }) => id)} current={openChat}>{(index) => {
        const item = found[index]!;
        return (
        <ItemRow
          key={item.id}
          title={item.title}
          time={item.at === null ? '' : ago(item.at)}
          typing={writing.has(item.id)}
          preview={item.preview ?? '미리보기 없음'}
          current={item.id === openChat}
          onClick={() => navigate({ kind: 'chat', id: item.id })}
        />
        );
      }}</Viewport>
      {shelf.chats.length === 0 ? <Empty variant="side">{`${NO_CHATS}.`}</Empty> : none && <Empty variant="side">{none}</Empty>}
    </Sidebar>
  );
}
