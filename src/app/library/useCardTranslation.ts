import { useEffect, useRef, useState } from 'react';
import type { Chat } from '../../model/chat';
import { readableTexts, textTranslation, type Character } from '../../model/library';
import { setTextTranslation, translateSwitches } from '../../runtime/characters';
import { translateText, translatorOf, type TranslatorFailure } from '../../runtime/translate';
import { describeTranslateFailure } from '../common/failure';
import { useConnections, usePrompts, useSession } from '../session';
import { useToast } from '../toast';

const AT_ONCE = 3;

// Translate saved card text only: unsaved drafts would lose translations on write. Use chat reply language
// so new-chat greetings share results; save each completion and stop remaining work on unmount.
export function useCardTranslation(id: string, character: Character) {
  const session = useSession();
  const toast = useToast();
  // translatorOf reads these too.
  usePrompts();
  useConnections();
  const language = translateSwitches(session.store, id).replyLanguage;
  const chat: Chat = { title: null, character: id, models: {} };
  const translator = translatorOf(session.store, chat);
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const sources = readableTexts(character.card);
  const translationOf = (source: string) => textTranslation(character, source, language)?.text;
  const missing = sources.filter((source) => translationOf(source) === undefined);

  async function start() {
    const queue = [...(missing.length > 0 ? missing : sources)];
    const controller = new AbortController();
    abort.current = controller;
    setRunning(new Set(queue));
    const failures: TranslatorFailure[] = [];
    const next = async (): Promise<void> => {
      const source = queue.shift();
      if (source === undefined || controller.signal.aborted) return;
      const made = await translateText(session, chat, source, language, controller.signal, () => {});
      if (made.ok) {
        const saved = await setTextTranslation(session.store, id, source, language, made.translation);
        if (!saved.ok) toast.failed(saved, '번역 결과를 저장하지 못했어요.');
      } else if (made.failure.kind !== 'stopped') failures.push(made.failure);
      setRunning((current) => new Set([...current].filter((each) => each !== source)));
      return next();
    };
    await Promise.all(Array.from({ length: AT_ONCE }, next));
    if (abort.current === controller) abort.current = null;
    setRunning(new Set());
    if (failures.length > 0) toast.show(`${failures.length}개를 번역하지 못했어요. ${describeTranslateFailure(failures[0]!)}`);
  }

  return { translator, sources, missing, running, translationOf, start: () => void start(), stop: () => abort.current?.abort() };
}
