import type { Assignment } from '../connectors/assignment';
import type { TranslateSwitches } from './chat';
import type { FeatureSwitches } from './features';
import type { IllustrateSwitches } from './illustration';
import type { MemorySettings } from './memory';
import type { ToggleValues } from './prompt';

// Fixed id makes concurrent device creation conflict instead of duplicating settings.
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000000';
export const EMPTY_SETTINGS: Settings = { models: {} };

export type LabId = 'preread' | 'agents' | 'cacheguard';
export const labOn = (settings: Pick<Settings, 'labs'> | undefined, id: LabId) => settings?.labs?.includes(id) ?? false;

export type PrereadParts = { chat: boolean; system: boolean; lore: boolean };
// Preread token counts use o200k; batch is uncovered material required for a call.
// thinkLess overrides the profile with the least reasoning the model accepts.
export type PrereadSettings = { parts: PrereadParts; recent: number; batch: number; thinkLess: boolean };

// look keys are app/common/reading savedPresets fields, not arbitrary CSS properties.
export type SavedLook = { id: string; name: string; look: Record<string, string | number> };

// Shared defaults are resolved by runtime/chat-context, runtime/characters and runtime/memory;
// character-owned translation and illustration settings replace their shared settings.
export type Settings = {
  models: Assignment;
  prompt?: string;
  translatePrompt?: string;
  memoryPrompt?: string;
  illustratePrompt?: string;
  mascotPrompt?: string;
  prereadPrompt?: string;
  persona?: string;
  toggles?: ToggleValues;
  // 입력창에 고정: toggle keys shown beside the composer of every chat whose prompt, card or modules declare them.
  pinnedToggles?: string[];
  translate?: TranslateSwitches;
  illustrate?: IllustrateSwitches;
  profile?: string;
  memory?: Partial<MemorySettings>;
  // Always-on modules, in activation order; missing modules read as off.
  modules?: string[];
  // Precedes the character's own note in chat translations, never the standalone translator's.
  translatorNote?: string;
  // Tool-only note; never inherits the chats' global translator note (user, 2026-10-20).
  toolNote?: string;
  importNotice?: true;
  ledger?: 'filled' | { after: string };
  looks?: SavedLook[];
  // The shared 실패하면 다시 보내기, absent for RETRIES; a connection or a 설정 묶음 overrides it (runtime/connections retriesOf).
  retries?: number;
  loreBudget?: number;
  loreDepth?: number;
  loreRecursive?: boolean;
  loreFullWord?: boolean;
  labs?: string[];
  features?: FeatureSwitches;
  // 에이전트 in every chat, the first of the stacked lists (runtime/agents agentsOf).
  agents?: string[];
  // Its fields absent read through runtime/preread prereadSetup.
  preread?: Partial<PrereadSettings>;
  answerInstruction?: string;
  usageShown?: true;
  // 헤이젤 나우 (design §6.12): false stops every usage label this account's pages send; absent shares (the default).
  pulse?: false;
};
