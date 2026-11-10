import { useMemo, useState } from 'react';
import { previewLine, shown, type ChatItem } from '../../model/chat';
import { versionTree } from '../../runtime/chat/chat-log';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { BOOKMARK } from '../common/words';
import { useSession } from '../session';
import { Empty, List, ListItem, MenuItem, MoreMenu, SidePanel, useWide } from '../ui';
import { bookmarkRows, type BookmarkRow } from './bookmarks';
import { speaker } from './ChatMessage';
import type { OpenChat } from './useChat';

type Props = Pick<OpenChat, 'messages' | 'texts'> & {
  item: ChatItem;
  names: OpenChat['names'];
  onShow: OpenChat['actions']['showBookmark'];
  onUnmark: (id: string) => void;
  onRename: OpenChat['actions']['renameBookmark'];
  onClose: () => void;
};

export function ChatBookmarks({ item, messages, texts, names, onShow, onUnmark, onRename, onClose }: Props) {
  const { store } = useSession();
  const wide = useWide();
  const [naming, setNaming] = useState<BookmarkRow | null>(null);
  const tree = useMemo(() => versionTree(store, item.id), [item.messages]);
  const rows = bookmarkRows(item.chat.bookmarks ?? [], tree);
  const { character, me, modelName } = names;
  // Off the line shown, a message has no displayed text: its stored one stands in, as in the version switcher.
  const start = ({ message }: BookmarkRow) => {
    const at = messages.findIndex((each) => each.id === message.id);
    return previewLine(at === -1 ? shown(message).text : texts[at]!, shown(message).text);
  };

  // A narrow panel covers the story, so it steps aside for the message it points at.
  function show(row: BookmarkRow) {
    if (onShow(row) && !wide) onClose();
  }

  return (
    <SidePanel title={BOOKMARK} onClose={onClose}>
      {rows.length ? (
        <List label={BOOKMARK}>
          {rows.map((row) => {
            const who = speaker(row.message, character, me, modelName);
            return (
              <ListItem
                key={row.message.id}
                title={row.name ?? who}
                description={row.name ? `${who} · ${start(row)}` : start(row)}
                tags={row.to.length ? ['다른 버전'] : []}
                onClick={() => show(row)}
                control={
                  <MoreMenu of={BOOKMARK}>
                    <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming(row)} />
                    <MenuItem label={`${BOOKMARK} 해제`} onClick={() => onUnmark(row.message.id)} />
                  </MoreMenu>
                }
              />
            );
          })}
        </List>
      ) : (
        <Empty variant="section">북마크한 메시지가 없어요.</Empty>
      )}
      {naming && (
        <NameDialog
          title={`${BOOKMARK} ${ACTS.rename.label}`}
          value={naming.name ?? ''}
          blank="비워 두면 말한 사람의 이름으로 표시돼요."
          onSave={(name) => {
            onRename(naming.message.id, name);
            setNaming(null);
          }}
          onClose={() => setNaming(null)}
        />
      )}
    </SidePanel>
  );
}
