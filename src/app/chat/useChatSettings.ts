import { useMemo, useState } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import type { Chat, Writes } from '../../model/chat';
import type { Feature } from '../../model/features';
import { setAgentAt, withAgent } from '../../runtime/agents';
import type { ApiFailure, ApiResult } from '../../runtime/api';
import { chatModel, setChatModel, withMainModel } from '../../runtime/assignment';
import { setCast, setChatOwn, withCast, withOwn, withPromptOut, withPromptSent, type Own } from '../../runtime/chat-log';
import { setFeatureAt, withFeature } from '../../runtime/features';
import { chatPersona, pinPersona, setCurrentPersona } from '../../runtime/personas';
import { chatPrompt } from '../../runtime/prompts';
import { useCaptured, useSession } from '../session';
import { useToast } from '../toast';

type Draft = Omit<Chat, 'title' | 'character'>;
export type ChatSettingsActions = ReturnType<typeof useChatSettings>['actions'];

export function useChatSettings(id: string | null, saved: Chat | null, character: string | null) {
  const { store } = useSession();
  const toast = useToast();
  const [unsaved, setUnsaved] = useState<Draft>({ models: {} });
  const chat: Chat = useMemo(() => saved ?? { title: null, character, ...unsaved }, [saved, character, unsaved]);
  const { route, prompt, persona } = useCaptured((store) => ({ route: chatModel(store, chat, 'main'), prompt: chatPrompt(store, chat), persona: chatPersona(store, chat) }), [chat]);

  // Unsaved chats carry settings into first save. Afterward patch the latest stored copy, never render snapshots,
  // so other devices' settings survive.
  async function change(local: (current: Draft) => Draft, persist: (id: string) => Promise<ApiResult<unknown>>): Promise<{ ok: true } | ApiFailure> {
    if (id) return persist(id);
    setUnsaved(local);
    return { ok: true };
  }

  function pickModel(ref: ModelRef) {
    toast.settled(change((current) => withMainModel(current, ref), (id) => setChatModel(store, id, ref)));
  }

  // null: follow the default again. A new chat holds it until its first send. The caller reports a failure.
  const setOwn = (field: Own, value: string | null) => change((current) => withOwn(current, field, value), (id) => setChatOwn(store, id, field, value));

  const setPrompt = (value: string | null) =>
    character === null ? change((current) => withPromptSent(current, value), (id) => store.update('chat', id, (current) => withPromptSent(current, value))) : setOwn('prompt', value);
  const keepPromptOut = () => change(withPromptOut, (id) => store.update('chat', id, withPromptOut));

  // A pick is this chat's persona and the current one, which a chat not saved yet follows.
  async function choosePersona(persona: string): Promise<{ ok: true } | ApiFailure> {
    const own = await setOwn('persona', persona);
    return own.ok ? setCurrentPersona(store, persona) : own;
  }

  // A new chat's 시작 전 설문 answers, which its first save starts it from.
  const startWith = (variables: Writes) => setUnsaved((current) => ({ ...current, variables }));

  function changeCast(ids: string[]) {
    toast.settled(change((current) => withCast(current, chat.character, ids), (id) => setCast(store, id, ids)));
  }

  return {
    chat,
    route,
    prompt,
    persona,
    actions: {
      pickModel,
      setPrompt,
      keepPromptOut,
      setNote: (value: string | null) => setOwn('note', value),
      setIllustrateNote: (value: string | null) => setOwn('illustrateNote', value),
      choosePersona,
      pinPersona: (persona: string | null) => pinPersona(store, chat.character!, persona),
      setCast: changeCast,
      startWith,
      setFeature: (feature: Feature, value: boolean | null) => change((current) => withFeature(current, feature, value), (id) => setFeatureAt(store, { kind: 'chat', id }, feature, value)),
      setAgent: (agent: string, on: boolean) => change((current) => withAgent(current, agent, on), (id) => setAgentAt(store, { kind: 'chat', id }, agent, on)),
    },
  };
}
