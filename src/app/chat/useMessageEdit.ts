import { useState } from 'react';
import { shown } from '../../model/chat';
import { deleteMessage, deleteMessages, editShown, undeleteMessage, undeleteMessages } from '../../runtime/chat/message-acts';
import type { Shown } from '../../runtime/chat/talk';
import { linesOf, typeAt, withPart, type Part } from './editPart';
import { useSession } from '../session';
import { useToast } from '../toast';

// A part: the lines of the side the message shows, edited where they stand; shown is where they are drawn.
export type PartAt = Part & { side: 'text' | 'translation'; shown: Part };
// caret: where the edit box starts its caret, its end when absent.
type EditPart = PartAt & { value: string; caret?: number };
export type Editing = { id: string; text: string; translation: string | null; part?: EditPart };
// A key typed over a selected part, before: the drawn text ahead of the selection in its paragraph.
export type Typed = { before: string; key: string };

function editingOf(message: Shown, part: PartAt | null, typed?: Typed): Editing {
  const version = shown(message);
  const [text, translation] = [version.text, version.translation?.text ?? null];
  if (!part) return { id: message.id, text, translation };
  const value = linesOf(part.side === 'text' ? text : translation!, part);
  return { id: message.id, text, translation, part: { ...part, ...(typed ? typeAt(value, typed.before, typed.key) : { value }) } };
}

// edited: from the version edited to the one the edit makes.
export function useMessageEdit(id: string | null, messages: Shown[], regenerate: (message: Shown) => void, edited: (from: string, to: string) => void) {
  const session = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<Editing | null>(null);
  // Its message left the line shown (deleted, here or elsewhere, or another version picked above it): kept, the edit
  // would hold a phone's composer folded with no edit box left to close it.
  if (editing && !messages.some(({ id: each }) => each === editing.id)) setEditing(null);

  function save(message: Shown, { text, translation, part }: Editing, andReply: boolean) {
    if (!id) return;
    const [nextText, nextTranslation] = !part ? [text, translation] : part.side === 'text' ? [withPart(text, part, part.value), translation] : [text, withPart(translation!, part, part.value)];
    const version = crypto.randomUUID();
    edited(shown(message).id, version);
    toast.settled(editShown(session, id, message, nextText, nextTranslation, version));
    setEditing(null);
    const next = messages[messages.findIndex(({ id: each }) => each === message.id) + 1];
    if (andReply && next?.role === 'assistant') regenerate(next);
  }

  function saveEdit(message: Shown, andReply: boolean) {
    if (editing) save(message, editing, andReply);
  }

  // Saved as an edit that empties the part: it takes the shown version's place, as any edit does.
  const removePart = (message: Shown, part: PartAt) => save(message, { ...editingOf(message, null), part: { ...part, value: '' } }, false);

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
      edit: (message: Shown, part: PartAt | null, typed?: Typed) => setEditing(editingOf(message, part, typed)),
      changeEdit: (change: { text: string } | { translation: string }) => setEditing((current) => current && { ...current, ...change }),
      changePart: (value: string) => setEditing((current) => current?.part ? { ...current, part: { ...current.part, value } } : current),
      cancelEdit: () => setEditing(null),
      saveEdit,
      removePart,
      remove,
      removeFrom,
    },
  };
}
