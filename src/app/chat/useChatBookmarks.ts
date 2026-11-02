import { useEffect, useMemo, useState } from 'react';
import type { Chat } from '../../model/chat';
import { nameBookmark, setBookmark } from '../../runtime/chat-log';
import { pickVersion } from '../../runtime/message-acts';
import type { Shown } from '../../runtime/talk';
import { BOOKMARK } from '../common/words';
import { useSession } from '../session';
import { useToast } from '../toast';
import type { BookmarkRow } from './bookmarks';

export function useChatBookmarks(id: string | null, bookmarks: Chat['bookmarks'], messages: Shown[], busy: boolean, find: (ids: string[]) => void) {
  const session = useSession();
  const { store } = session;
  const toast = useToast();
  const bookmarked = useMemo(() => new Set(bookmarks?.map(({ message }) => message)), [bookmarks]);
  // A bookmark after another version, seeked once the switch to it puts it in the story: a seek to a row not there yet
  // is lost.
  const [seeking, setSeeking] = useState<string | null>(null);

  useEffect(() => {
    if (seeking === null || !messages.some((message) => message.id === seeking)) return;
    find([seeking]);
    setSeeking(null);
  }, [messages, seeking]);

  function bookmark(message: string) {
    if (!id) return;
    const on = !bookmarked.has(message);
    toast.settled(setBookmark(store, id, message, on));
    const name = on ? undefined : bookmarks?.find((each) => each.message === message)?.name;
    if (name !== undefined) toast.undoable(`'${name}' ${BOOKMARK}를 해제했어요.`, () => setBookmark(store, id, message, true, name));
  }

  // false: it stays where it is.
  function showBookmark({ message, to }: BookmarkRow): boolean {
    if (!id) return false;
    if (!to.length) {
      find([message.id]);
      return true;
    }
    if (busy) {
      toast.show('응답이 끝나면 다른 버전으로 넘어갈 수 있어요.');
      return false;
    }
    setSeeking(message.id);
    for (const { message: above, index } of to) {
      void pickVersion(session, id, above, index).then((saved) => {
        if (saved.ok) return;
        setSeeking(null);
        toast.failed(saved);
      });
    }
    return true;
  }

  function renameBookmark(message: string, name: string) {
    if (id) toast.settled(nameBookmark(store, id, message, name));
  }

  return { bookmarked, actions: { bookmark, showBookmark, renameBookmark } };
}
