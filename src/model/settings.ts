import type { Assignment, ModelRef } from '../connectors/assignment';
import type { TranslateSwitches } from './chat';
import type { FeatureSwitches } from './features';
import type { IllustrateSwitches } from './illustration';
import type { MemorySettings } from './memory';
import type { ToggleValues } from './prompt';

// Fixed id makes concurrent device creation conflict instead of duplicating settings.
export const SETTINGS_ID = '00000000-0000-4000-8000-000000000000';
export const EMPTY_SETTINGS: Settings = { models: {} };

export type LabId = 'preread' | 'agents' | 'cacheguard' | 'status';
export const labOn = (settings: Pick<Settings, 'labs'>, id: LabId) => settings.labs?.includes(id) ?? false;

export type PrereadParts = { chat: boolean; system: boolean; lore: boolean };
// Preread token counts use o200k; batch is uncovered material required for a call.
// thinkLess overrides the profile with the least reasoning the model accepts.
export type PrereadSettings = { parts: PrereadParts; recent: number; batch: number; thinkLess: boolean };

// look keys are app/common/reading savedPresets fields, not arbitrary CSS properties.
export type SavedLook = { id: string; name: string; look: Record<string, string | number> };

const PLAIN = { bg: 'base', ink: 'base', accent: 'base', dialogue: 'base' };
// The presets an account starts with, its own to rename, reorder and remove. Their ids are fixed: a character's look
// and a 시스템 따라 바꾸기 slot may hold them. 기본's size is --prose-size and its font, spacing and theme the device
// defaults (ChatFrame readingDefault, DISPLAY_DEFAULT), so 기본값으로 되돌리기 lands on it.
export const STARTER_PRESETS: SavedLook[] = [
  { id: 'default', name: '기본', look: { theme: 'dark', ...PLAIN, font: 'serif', size: 17, leading: 'normal', width: 'normal' } },
  { id: 'study', name: '밝은 서재', look: { theme: 'light', ...PLAIN, font: 'serif', size: 17, leading: 'normal', width: 'normal' } },
  { id: 'gothic', name: '고딕 간결', look: { theme: 'dark', ...PLAIN, font: 'sans', size: 15, leading: 'narrow', width: 'narrow' } },
  { id: 'wide', name: '넓게 읽기', look: { theme: 'dark', ...PLAIN, font: 'serif', size: 18, leading: 'wide', width: 'wide' } },
  { id: 'sea', name: '밤바다', look: { theme: 'dark', ...PLAIN, bg: 'blue', accent: 'blue', dialogue: 'sky', font: 'serif', size: 17, leading: 'normal', width: 'normal' } },
  { id: 'forest', name: '숲', look: { theme: 'dark', ...PLAIN, bg: 'green', accent: 'green', dialogue: 'lime', font: 'serif', size: 17, leading: 'normal', width: 'normal' } },
  { id: 'sepia', name: '세피아', look: { theme: 'light', ...PLAIN, bg: 'brown', font: 'serif', size: 17, leading: 'wide', width: 'normal' } },
];

export const presetsOf = (settings: Pick<Settings, 'presets'>) => settings.presets ?? STARTER_PRESETS;

// Shared defaults are resolved by runtime/chat/chat-context, runtime/library/characters and runtime/tasks/memory;
// character-owned translation and illustration settings replace their shared settings.
// What this person has been shown, so no device of theirs shows it again.
export type Seen = { tutorials?: string[]; welcome?: true; tour?: string; opened?: string };

export type Settings = {
  models: Assignment;
  prompt?: string;
  translatePrompt?: string;
  memoryPrompt?: string;
  illustratePrompt?: string;
  mascotPrompt?: string;
  prereadPrompt?: string;
  statusPrompt?: string;
  // 공용's alone, as their prompts are; absent for the chat's 보조 모델. 번역's and 삽화's are in their switches.
  memoryModel?: ModelRef;
  mascotModel?: ModelRef;
  prereadModel?: ModelRef;
  statusModel?: ModelRef;
  persona?: string;
  toggles?: ToggleValues;
  // 입력창에 고정: toggle keys shown beside the composer of every chat whose prompt, card or modules declare them.
  pinnedToggles?: string[];
  // Each pin its own button on the row. Absent: one button opens them all.
  pinnedTogglesSpread?: true;
  // Composer tools moved behind 더보기: the app's own keys (ChatComposer) and module ids. Absent: all on the row.
  hiddenTools?: string[];
  // Those keys in the order the row shows them. A tool not listed yet follows them. Absent: the app's own order.
  toolOrder?: string[];
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
  toolLanguage?: string;
  importNotice?: true;
  ledger?: 'filled' | { after: string };
  // How far the one fill of the ledger's unknown purposes went (runtime/models/usage fillPurposes); absent, not begun.
  purposes?: 'filled' | { after: string };
  // How many of runtime/import/reread's steps every import original kept here has had; absent, none.
  reread?: number;
  // 디스플레이 presets, in the order shown. Absent: STARTER_PRESETS.
  presets?: SavedLook[];
  // How many model calls one reply may make while its model calls plugin tools, absent for TOOL_ROUNDS.
  toolRounds?: number;
  // The shared 실패하면 다시 보내기, absent for RETRIES; a connection or a 설정 묶음 overrides it (runtime/models/connections retriesOf).
  retries?: number;
  loreBudget?: number;
  loreDepth?: number;
  loreRecursive?: boolean;
  loreFullWord?: boolean;
  labs?: string[];
  features?: FeatureSwitches;
  // 에이전트 in every chat, the first of the stacked lists (runtime/tasks/agents agentsOf).
  agents?: string[];
  // Its fields absent read through runtime/tasks/preread prereadSetup.
  preread?: Partial<PrereadSettings>;
  answerInstruction?: string;
  usageShown?: true;
  cacheNoteHidden?: true;
  seen?: Seen;
  // 헤이젤 나우 (design §6.12): false stops every usage label this account's pages send; absent shares (the default).
  pulse?: false;
  // 자동 진단 (design §6.13): false sends none; absent sends (the default).
  diagnosis?: false;
};
