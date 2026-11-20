import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chat, ChatSummary } from '../../model/chat';
import { textTranslation, type CharacterShelf } from '../../model/library';
import { startChat } from '../../runtime/chat/chat-log';
import { draftKey } from '../../runtime/device/drafts';
import { followGreetings, greetingPreview, projectGreetings, startingGreetings } from '../../runtime/chat/greetings';
import type { Shown } from '../../runtime/chat/talk';
import type { Starting } from '../../runtime/chat/turn';
import type { Unsaved } from '../../runtime/chat/turn-context';
import { useSession } from '../session';
import { navigate } from '../shell/router';
import { sameItems } from './rowPart';

const sameTexts = sameItems<string>(Object.is);

// A new chat's greeting, shown until its first save, and that save. fresh: the chat is not saved yet.
export function useNewChat(chatId: string, fresh: boolean, chat: Chat, shelf: CharacterShelf<ChatSummary> | null, replyLanguage: string) {
  const { store, drafts } = useSession();
  const card = shelf?.character.card ?? null;
  const [openedAt] = useState(() => Date.now());
  const greetings = card?.greetings ?? [];
  // Preserve greeting ids through first save so seeds and story rows stay stable; each follows its greeting through the
  // card's edits beside the chat, and the pick follows its id. A picked greeting the card drops leaves the default.
  const [opening, setOpening] = useState(() => ({ texts: greetings, ids: followGreetings([], [], greetings) }));
  const [picked, setPicked] = useState<string | null>(null);
  let { ids } = opening;
  if (!sameTexts(opening.texts, greetings)) {
    ids = followGreetings(opening.texts, ids, greetings);
    setOpening({ texts: greetings, ids });
  }
  const at = picked === null ? -1 : ids.indexOf(picked);
  const selected = at === -1 ? null : at;
  const choices = useMemo(() => fresh && card
    ? projectGreetings(greetings, ids, selected, (text) => textTranslation(shelf!.character, text, replyLanguage))
    : null, [fresh, card, shelf?.character.translations, replyLanguage, ids, selected]);
  const unstarted: Shown | null = useMemo(() => {
    const preview = greetingPreview(choices, openedAt);
    return preview && { ...preview, live: null };
  }, [choices, openedAt]);
  // What the first save will write, which a forecast reads: a blank greeting is shown but not saved.
  const unsaved = useMemo((): Unsaved | null => {
    if (!fresh) return null;
    const greeting = greetingPreview(startingGreetings(choices), openedAt);
    return { chat, messages: greeting ? [greeting] : [] };
  }, [fresh, chat, choices, openedAt]);

  // The one save, which the first send and a press on the greeting share until it lands; a failed one is begun afresh
  // by the next.
  const start = useRef<Starting | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  function starting(): Starting {
    if (start.current) return start.current;
    const greetings = startingGreetings(choices);
    const saved = startChat(store, chatId, chat, greetings).then((unstarted) => {
      if (unstarted) start.current = null;
      else {
        // Change route only once projection exists or it would flash loading. Keep failures on the chat scope;
        // never navigate back to a chat whose screen the user already left.
        const open = () => {
          drafts.move(draftKey(null, chat.character), chatId);
          if (mounted.current) navigate({ kind: 'chat', id: chatId }, { replace: true });
        };
        void store.projections.evaluate(chatId).then(open, open);
      }
      return unstarted;
    });
    return (start.current = { greeting: greetings && greetings.choices[greetings.selected]!.id, saved });
  }

  return { unstarted, unsaved, pickGreeting: (index: number) => setPicked(ids[index]!), starting };
}
