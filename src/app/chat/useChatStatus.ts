import { useState } from 'react';
import type { Display } from '../../engine/display';
import type { Chat } from '../../model/chat';
import type { Character } from '../../model/library';
import { setStatusScript } from '../../runtime/characters';
import { chatScripts, packsOf, statusBoxes, statusPlaces } from '../../runtime/chat-context';
import type { Shown } from '../../runtime/talk';
import { useSession } from '../session';
import { moduleName, scriptName } from '../common/words';
import { useToast } from '../toast';
import { useSeen } from './useSeen';

export function useChatStatus(chat: Chat, settings: Character | null, view: Display, messages: Shown[]) {
  const { store } = useSession();
  const toast = useToast();
  const { character } = chat;
  const card = settings?.card ?? null;
  const bot = settings?.decor !== false;
  // 상태창 지정 (design §6.4).
  const scripts = bot && card ? chatScripts(packsOf(store, chat)) : [];
  const statusScripts = statusPlaces(scripts, settings?.statusScripts ?? []);
  const nameAt = (place: number) => {
    const { script, index, module } = scripts[place]!;
    const name = scriptName(script.name, 'regex', index);
    return module === null ? name : `${name} · ${moduleName(store.get('module', module)?.value.name ?? '')}`;
  };
  const status = statusBoxes(view, messages, statusScripts).map((box) => ({ ...box, name: nameAt(box.place) }));
  const offered = (index: number) =>
    view.drawn[index]!.flatMap((place) => (scripts[place] ? [{ id: scripts[place].mark, name: nameAt(place), marked: statusScripts.some(({ place: marked }) => marked === place) }] : []));
  const hosted = (index: number) => status.flatMap(({ id, drawn }) => (drawn?.message === index ? [{ ...drawn, id }] : []));
  const { seen, watch } = useSeen();
  // 상태 shown over the story by a key or a tap, rather than by pointing at its tab.
  const [held, hold] = useState(false);
  const peeking = status.length > 0 && (held || status.some(({ id }) => !seen.has(id)));

  function markStatus({ id, name }: { id: string; name: string }, on: boolean) {
    if (!character) return;
    void setStatusScript(store, character, id, on).then((saved) => saved.ok || toast.failed(saved));
    if (!on && statusScripts.length === 1) hold(false);
    toast.undoable(on ? '상태창으로 지정했어요' : '상태창 지정을 해제했어요', () => setStatusScript(store, character, id, !on), [name, card?.name].filter(Boolean).join(' · '));
  }

  return {
    status,
    hosted,
    offered,
    held,
    peeking,
    actions: {
      hold,
      markStatus,
      watch,
    },
  };
}
