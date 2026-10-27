import { useEffect, useMemo, useRef, useState } from 'react';
import type { Chat, ChatSummary } from '../../model/chat';
import { textTranslation, type CharacterShelf } from '../../model/library';
import { startChat } from '../../runtime/chat-log';
import { draftKey } from '../../runtime/drafts';
import { greetingPreview, projectGreetings, startingGreetings } from '../../runtime/greetings';
import type { Shown } from '../../runtime/talk';
import type { Starting } from '../../runtime/turn';
import type { Unsaved } from '../../runtime/turn-context';
import { useSession } from '../session';
import { navigate } from '../shell/router';

// A new chat's greeting, shown until its first save, and that save. fresh: the chat is not saved yet.
export function useNewChat(chatId: string, fresh: boolean, chat: Chat, shelf: CharacterShelf<ChatSummary> | null, replyLanguage: string) {
  const { store, drafts } = useSession();
  const card = shelf?.character.card ?? null;
  const [openedAt] = useState(() => Date.now());
  const greetings = card?.greetings ?? [];
  const [picked, pickGreeting] = useState<number | null>(null);
  // Preserve greeting ids through first save so seeds and story rows stay stable. Newly added greetings get new ids.
  const [madeIds, setOpeningIds] = useState(() => greetings.map(() => crypto.randomUUID()));
  const openingIds = madeIds.length < greetings.length ? [...madeIds, ...greetings.slice(madeIds.length).map(() => crypto.randomUUID())] : madeIds;
  if (openingIds !== madeIds) setOpeningIds(openingIds);
  const choices = useMemo(() => fresh && card
    ? projectGreetings(greetings, openingIds, picked, (text) => textTranslation(shelf!.character, text, replyLanguage))
    : null, [fresh, card, shelf?.character.translations, replyLanguage, openingIds, picked]);
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

  return { unstarted, unsaved, pickGreeting, starting };
}
