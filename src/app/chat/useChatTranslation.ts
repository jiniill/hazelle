import { useRef, useState } from 'react';
import { shown, type Chat, type TranslateSwitches } from '../../model/chat';
import { setOwnTranslate, setTranslate, type TranslateSetup } from '../../runtime/library/characters';
import { translationInput } from '../../runtime/chat/chat-context';
import type { Shown } from '../../runtime/chat/talk';
import { translationShown, translatorOf, type TranslatorFailure } from '../../runtime/tasks/translate';
import { languageLabel } from '../common/languages';
import { useCaptured, useSession, useTranslating } from '../session';
import { useToast } from '../toast';

export type TranslationActions = ReturnType<typeof useChatTranslation>['actions'];

export function useChatTranslation(chatId: string, chat: Chat, messages: Shown[], texts: string[], translate: TranslateSetup) {
  const session = useSession();
  const { store, translator } = session;
  const toast = useToast();
  const translating = useTranslating();
  const translation = useCaptured((store) => translatorOf(store, chat), [chat]);
  const shownTranslation = useCaptured((store) => translationShown(store, chat), [chat]);
  const sendLanguage = languageLabel(translate.inputLanguage);
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  const last = messages.at(-1);
  // 응답 번역 is shown awaited from the reply's first text; whether and when it starts is translateReceived's. Live
  // until its turn ends, the translator's from its save (Translator.expect).
  const live = translate.replies && last?.live && texts.at(-1)!.trim() ? last.live : null;
  const awaited = (version: string) => version === live || translating.awaited.has(version);

  // A batch (ChatExport) goes on across renders: each message in it reads the chat as it is by then, the
  // translations landed before it among its context.
  const latest = useRef({ chat, messages });
  latest.current = { chat, messages };

  async function translateMessage(message: Shown): Promise<TranslatorFailure | null> {
    const { chat, messages } = latest.current;
    const index = messages.findIndex(({ id }) => id === message.id);
    const version = shown(messages[index]!);
    await translator.translate(chatId, version, translationInput(session, chatId, chat, messages, { kind: 'message', index }));
    return translator.snapshot().failed.get(version.id) ?? null;
  }

  function flipTranslation(message: Shown) {
    const version = shown(message).id;
    const next = new Set(flipped);
    if (!next.delete(version)) next.add(version);
    setFlipped(next);
  }

  function carryFlip(from: string, to: string) {
    setFlipped((current) => (current.has(from) ? new Set([...current, to]) : current));
  }

  function setSwitches(change: Partial<TranslateSwitches>) {
    toast.settled(setTranslate(store, chat.character, change));
  }

  function setOwnSwitches(own: boolean) {
    toast.settled(setOwnTranslate(store, chat.character!, own));
  }

  return {
    translation, shownTranslation, sendLanguage, translating, flipped, awaited,
    actions: {
      translate: translateMessage,
      flipTranslation,
      carryFlip,
      setTranslate: setSwitches,
      setOwnTranslate: setOwnSwitches,
    },
  };
}
