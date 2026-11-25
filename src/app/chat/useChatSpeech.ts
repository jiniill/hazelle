import { useEffect, useMemo } from 'react';
import type { Chat } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import type { Speech, SpeechSwitches } from '../../model/speech';
import { setOwnSpeech, setSpeech } from '../../runtime/library/characters';
import { chatSpeech } from '../../runtime/tasks/features';
import type { SpeechFailure } from '../../runtime/tasks/speech';
import { describeSpeechFailure } from '../common/failure';
import { useCaptured, useChildren, useReadings, useSession } from '../session';
import { useToast } from '../toast';
import { useToldFailures } from './useToldFailures';

const told = new WeakSet<SpeechFailure>();

const NO_SPEECH: Speech['of'][] = [];

function keptByVersion(speeches: Stored<'speech'>[]): ReadonlyMap<string, Speech['of'][]> {
  const versions = new Map<string, Speech['of'][]>();
  for (const { value } of speeches) versions.set(value.version, [...(versions.get(value.version) ?? []), value.of]);
  return versions;
}

export type SpeechActions = ReturnType<typeof useChatSpeech>['actions'];

export function useChatSpeech(chatId: string, id: string | null, chat: Chat) {
  const { character } = chat;
  const { store, speaker } = useSession();
  const toast = useToast();
  const speech = useCaptured((store) => chatSpeech(store, chat), [chat]);
  const speeches = useChildren('speech', id);
  const kept = useMemo(() => keptByVersion(speeches), [speeches]);
  const readings = useReadings();

  useToldFailures(readings, chatId, { told, failures: (reading) => [reading.failure], key: (failure) => failure, describe: describeSpeechFailure });

  // 자동 읽기 starts a reading without a press, which a phone plays only once a press on the page has played one.
  useEffect(() => {
    if (!speech.auto) return;
    const unlock = () => speaker.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [speech.auto, speaker]);

  // original: the message shows its original over a translation it has (원문 보기).
  function listen(message: string, version: string, original: boolean, remake = false) {
    if (!id) return;
    speaker.unlock();
    speaker.play(id, message, version, { original, remake });
  }

  return {
    speech,
    readings,
    keptOf: (version: string) => kept.get(version) ?? NO_SPEECH,
    actions: {
      setSpeech: (change: Partial<SpeechSwitches>) => toast.settled(setSpeech(store, character, change)),
      setOwnSpeech: (own: boolean) => toast.settled(setOwnSpeech(store, character!, own)),
      listen,
      stopListening: () => speaker.stop(),
    },
  };
}
