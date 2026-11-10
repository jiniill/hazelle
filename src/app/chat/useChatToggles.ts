import type { Chat } from '../../model/chat';
import type { TogglePreset, ToggleValues } from '../../model/prompt';
import type { ApiResult } from '../../runtime/api';
import { resetToggles, setToggleValues } from '../../runtime/library/characters';
import { packsOf, togglesOf } from '../../runtime/chat/chat-context';
import type { PromptChoice } from '../../runtime/library/prompts';
import { useSaves, useSession } from '../session';
import { useToast } from '../toast';
import { presetValues, sectionValues, toggleRows, toggleSaveKey, type ToggleRows, type ToggleSection } from './toggles';

export function useChatToggles(chat: Chat, prompt: PromptChoice, toggles: ToggleRows) {
  const { store } = useSession();
  const saves = useSaves();
  const toast = useToast();

  // A value is the character's, in every chat of it, or shared by every 캐릭터 없이 chat.
  const writeToggle = (key: string, value: string) => setToggleValues(store, chat.character, { [key]: value });

  function flip(key: string, value: string) {
    toast.settled(writeToggle(key, value));
  }

  // A typed value still waiting would land over a reset or a preset, and be missed by a preset saved now.
  const settleTyped = () => Promise.all(toggles.sections.flatMap(({ rows }) => rows.flatMap(({ toggle }) => (toggle.kind === 'text' ? [saves.flush(toggleSaveKey(chat.character, toggle.key))] : []))));

  async function reset() {
    await settleTyped();
    toast.settled(resetToggles(store, chat.character));
    toast.show(`토글 ${toggles.changed}개를 기본값으로 되돌렸어요.`);
  }

  async function pickPreset(section: ToggleSection, preset: TogglePreset) {
    await settleTyped();
    toast.settled(setToggleValues(store, chat.character, presetValues(section, preset)));
  }

  // Read again once typed values are stored, not from the rows this render holds.
  async function sectionNow(id: string): Promise<ApiResult<ToggleValues>> {
    await settleTyped();
    const section = toggleRows(togglesOf(store, chat, prompt, packsOf(store, chat))).sections.find((each) => each.id === id);
    return section ? { ok: true, data: sectionValues(section) } : { ok: false, error: 'gone' };
  }

  return {
    actions: {
      flip,
      writeToggle,
      resetToggles: reset,
      pickPreset: (section: ToggleSection, preset: TogglePreset) => void pickPreset(section, preset),
      sectionNow,
    },
  };
}
