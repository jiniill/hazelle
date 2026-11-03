import { removeChat, renameChat, restoreChat } from '../../runtime/chat-log';
import { NameDialog } from '../common/NameDialog';
import { BIN_KEEPS } from '../common/words';
import { useSession } from '../session';
import { navigate, useRoute } from '../shell/router';
import { useToast } from '../toast';

type Edited = { id: string; title: string; character: string | null };

// A chat renamed or deleted from its header's ⋯ or from its row in the list.
export function useChatEdits() {
  const { store, talk } = useSession();
  const toast = useToast();
  const route = useRoute();
  const rename = (id: string, name: string) => toast.settled(renameChat(store, id, name));
  const drop = ({ id, title, character }: Edited) => {
    const open = route.kind === 'chat' && route.id === id;
    talk.stop(id);
    toast.settled(removeChat(store, id));
    if (open) navigate({ kind: 'shelf', character });
    toast.undoable(`'${title}' 채팅을 삭제했어요.`, () => {
      const restored = restoreChat(store, id);
      if (open) navigate({ kind: 'chat', id });
      return restored;
    }, BIN_KEEPS);
  };
  return { rename, drop };
}

export const ChatNameDialog = ({ title, onSave, onClose }: { title: string; onSave: (name: string) => void; onClose: () => void }) => (
  <NameDialog title="채팅 이름 바꾸기" value={title} blank="비워 두면 첫 메시지가 제목으로 표시돼요." onSave={onSave} onClose={onClose} />
);
