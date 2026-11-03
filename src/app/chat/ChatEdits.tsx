import { allWritten } from '../../runtime/api';
import { removeChat, renameChat, restoreChat } from '../../runtime/chat-log';
import { NameDialog } from '../common/NameDialog';
import { BIN_KEEPS } from '../common/words';
import { useSession } from '../session';
import { navigate, useRoute } from '../shell/router';
import { useToast } from '../toast';

type Edited = { id: string; title: string; character: string | null };

// Chats renamed or deleted from a chat's header ⋯, its row in the list, or a pick of rows.
export function useChatEdits() {
  const { store, talk } = useSession();
  const toast = useToast();
  const route = useRoute();
  const rename = (id: string, name: string) => {
    const renamed = renameChat(store, id, name);
    toast.settled(renamed);
    // A cleared title shows the summary's, which only an opened chat writes again.
    if (!name.trim()) void renamed.then((done) => {
      if (!done.ok) return;
      const lease = store.retainChat(id);
      void lease.ready.finally(lease.release);
    });
  };
  const drop = (chats: readonly Edited[]) => {
    const open = route.kind === 'chat' ? chats.find(({ id }) => id === route.id) : undefined;
    for (const { id } of chats) talk.stop(id);
    toast.settled(allWritten(chats.map(({ id }) => removeChat(store, id))));
    if (open) navigate({ kind: 'shelf', character: open.character });
    toast.undoable(chats.length === 1 ? `'${chats[0]!.title}' 채팅을 삭제했어요.` : `채팅 ${chats.length}개를 삭제했어요.`, () => {
      const restored = allWritten(chats.map(({ id }) => restoreChat(store, id)));
      if (open) navigate({ kind: 'chat', id: open.id });
      return restored;
    }, BIN_KEEPS);
  };
  return { rename, drop };
}

export const ChatNameDialog = ({ title, onSave, onClose }: { title: string; onSave: (name: string) => void; onClose: () => void }) => (
  <NameDialog title="채팅 이름 바꾸기" value={title} blank="비워 두면 첫 메시지가 제목으로 표시돼요." onSave={onSave} onClose={onClose} />
);
