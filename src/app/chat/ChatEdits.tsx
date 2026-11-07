import type { ChatSummary } from '../../model/chat';
import { allWritten, type ApiResult } from '../../runtime/api';
import { forgetOrigin as forgetChatOrigin, removeChat, renameChat, restoreChat } from '../../runtime/chat-log';
import { branchFrom, duplicateChat } from '../../runtime/message-acts';
import { NameDialog } from '../common/NameDialog';
import { BIN_KEEPS, copyName } from '../common/words';
import { useSession } from '../session';
import { navigate, useRoute } from '../shell/router';
import { useToast } from '../toast';

type Edited = { id: string; title: string; character: string | null };

// Chats renamed, copied or deleted from a chat's header ⋯, a message's ⋯, its row in the list, or a pick of rows.
export function useChatEdits() {
  const session = useSession();
  const { store, talk } = session;
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
  const forgetOrigin = (id: string) => toast.settled(forgetChatOrigin(store, id));
  // A copy is not opened: the reader stays where the next copy is made from, and its toast offers 열기.
  const copying = async (made: Promise<ApiResult<string>>, said: { busy: string; failed: string; made: string }) => {
    toast.show(said.busy);
    const copy = await made;
    if (!copy.ok) return toast.failed(copy, said.failed);
    toast.show(said.made, { action: { label: '열기', onClick: () => navigate({ kind: 'chat', id: copy.data }) } });
  };
  const branch = (chat: string, message: string) => copying(branchFrom(session, chat, message), { busy: '채팅 분기 중…', failed: '채팅을 분기하지 못했어요.', made: '새 채팅으로 분기했어요.' });
  const duplicate = ({ id, title }: Pick<ChatSummary, 'id' | 'title'>) => copying(duplicateChat(session, id, copyName(title)), { busy: '사본 만드는 중…', failed: '사본을 만들지 못했어요.', made: '사본을 만들었어요.' });
  return { rename, drop, forgetOrigin, branch, duplicate };
}

export const ChatNameDialog = ({ title, onSave, onClose }: { title: string; onSave: (name: string) => void; onClose: () => void }) => (
  <NameDialog title="채팅 이름 바꾸기" value={title} blank="비워 두면 첫 메시지가 제목으로 표시돼요." onSave={onSave} onClose={onClose} />
);
