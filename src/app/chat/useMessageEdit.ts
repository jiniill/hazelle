import { useState } from 'react';
import { shown } from '../../model/chat';
import { deleteMessage, deleteMessages, editShown, undeleteMessage, undeleteMessages } from '../../runtime/message-acts';
import type { Shown } from '../../runtime/talk';
import { linesOf, withPart, type Part } from './editPart';
import { useSession } from '../session';
import { useToast } from '../toast';

// A part: the lines of the side the message shows, edited where they stand; shown is where they are drawn.
export type EditPart = Part & { side: 'text' | 'translation'; shown: Part; value: string };
export type Editing = { id: string; text: string; translation: string | null; part?: EditPart };

// edited: from the version edited to the one the edit makes.
export function useMessageEdit(id: string | null, messages: Shown[], regenerate: (message: Shown) => void, edited: (from: string, to: string) => void) {
  const session = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  // Its message left the line shown (deleted, here or elsewhere, or another version picked above it): kept, the edit
  // would hold a phone's composer folded with no edit box left to close it.
  if (editing && !messages.some(({ id: each }) => each === editing.id)) setEditing(null);

  function saveEdit(message: Shown, andReply: boolean) {
    if (!id || !editing) return;
    const { text, translation, part } = editing;
    const [nextText, nextTranslation] = !part ? [text, translation] : part.side === 'text' ? [withPart(text, part, part.value), translation] : [text, withPart(translation!, part, part.value)];
    const version = crypto.randomUUID();
    edited(shown(message).id, version);
    toast.settled(editShown(session, id, message, nextText, nextTranslation, version));
    setEditing(null);
    const next = messages[messages.findIndex(({ id: each }) => each === message.id) + 1];
    if (andReply && next?.role === 'assistant') regenerate(next);
  }

  function remove(message: Shown) {
    if (!id) return;
    toast.settled(deleteMessage(session, id, message));
    toast.undoable('메시지를 삭제했어요.', () => undeleteMessage(session, id, message));
  }

  // The message and every one after it.
  function removeFrom(message: Shown) {
    if (!id) return;
    const from = messages.findIndex(({ id: each }) => each === message.id);
    if (from === -1) return;
    const gone = messages.slice(from);
    toast.settled(deleteMessages(session, id, gone));
    toast.undoable(`메시지 ${gone.length}개를 삭제했어요.`, () => undeleteMessages(session, id, gone));
  }

  return {
    editing,
    actions: {
      edit: (message: Shown, part: Omit<EditPart, 'value'> | null) => {
        const version = shown(message);
        const [text, translation] = [version.text, version.translation?.text ?? null];
        setEditing({ id: message.id, text, translation, ...(part && { part: { ...part, value: linesOf(part.side === 'text' ? text : translation!, part) } }) });
      },
      changeEdit: (change: { text: string } | { translation: string }) => setEditing((current) => current && { ...current, ...change }),
      changePart: (value: string) => setEditing((current) => current?.part ? { ...current, part: { ...current.part, value } } : current),
      cancelEdit: () => setEditing(null),
      saveEdit,
      remove,
      removeFrom,
    },
  };
}
