import { useMemo } from 'react';
import { chatPrompt } from '../../runtime/library/prompts';
import { useChats, usePrompts, useSettings, useStore } from '../session';
import { ago } from './time';

export type PromptUse = { chats: number; at: number | null };

export function usePromptUse(): ReadonlyMap<string, PromptUse> {
  const store = useStore();
  const chats = useChats();
  const prompts = usePrompts();
  const settings = useSettings();
  return useMemo(() => {
    const uses = new Map<string, PromptUse>();
    for (const item of chats) {
      const choice = chatPrompt(store, item.chat);
      if (choice.kind !== 'prompt') continue;
      const use = uses.get(choice.prompt.id) ?? { chats: 0, at: null };
      const at = item.at === null ? use.at : Math.max(use.at ?? 0, item.at);
      uses.set(choice.prompt.id, { chats: use.chats + 1, at });
    }
    return uses;
  }, [store, chats, settings, prompts]);
}

export const EMPTY_USE: PromptUse = { chats: 0, at: null };


// An unused prompt says nothing, so the few in use stand out in a long list.
export const promptUseWords = ({ chats, at }: PromptUse) => (chats ? (at === null ? `채팅 ${chats}개` : `채팅 ${chats}개 · ${ago(at)} 씀`) : undefined);
