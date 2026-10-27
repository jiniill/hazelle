import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Mark } from './library';
import type { FeatureSwitches } from './features';

export type Role = 'system' | 'user' | 'assistant';

export const PROMPT_SORTS = ['conversation', 'translate', 'memory', 'illustrate', 'mascot', 'preread', 'agent'] as const;
export type PromptSort = (typeof PROMPT_SORTS)[number];

// wrapped slots interpolate {{slot}} and start with their declared role (app/prompts/edits newBlock).
export const SLOTS = {
  tool: { wrapped: true, role: 'system', repeats: false, sorts: ['conversation'] },
  // Description/persona slots must repeat: Risu presets toggle between separate placements; deduplication drops content.
  description: { wrapped: true, role: 'system', repeats: true, sorts: ['conversation', 'translate', 'memory', 'illustrate', 'agent'] },
  persona: { wrapped: true, role: 'system', repeats: true, sorts: ['conversation', 'translate', 'memory', 'illustrate', 'agent'] },
  lorebook: { wrapped: false, repeats: false, sorts: ['conversation', 'translate', 'memory', 'illustrate', 'agent'] },
  authorNote: { wrapped: true, role: 'system', repeats: false, sorts: ['conversation'] },
  postEverything: { wrapped: false, repeats: false, sorts: ['conversation'] },
  chat: { wrapped: false, repeats: true, sorts: ['conversation'] },
  note: { wrapped: true, role: 'system', repeats: false, sorts: ['translate'] },
  illustrateNote: { wrapped: true, role: 'system', repeats: false, sorts: ['illustrate'] },
  recent: { wrapped: true, role: 'system', repeats: false, sorts: ['translate', 'illustrate', 'mascot', 'agent'] },
  // source is task-specific: numbered paragraphs, displayed mascot reply, preread material,
  // or the answered message (pre-agent) / saved reply (post-agent).
  source: { wrapped: true, role: 'user', repeats: false, sorts: ['translate', 'illustrate', 'mascot', 'preread', 'agent'] },
  // 에이전트 노트: the pre agents' notes for the reply (design §6.16); a prompt without it gets them after the chat.
  agentNotes: { wrapped: true, role: 'system', repeats: false, sorts: ['conversation'] },
  // An agent's own memory as it last left it, with the answer shape that keeps it (engine/agent memorySheet).
  agentMemory: { wrapped: true, role: 'system', repeats: false, sorts: ['agent'] },
  // The mascot's own sheet, which the engine writes (engine/mascot): its voice, faces, last lines and answer shape.
  mascot: { wrapped: true, role: 'system', repeats: false, sorts: ['mascot'] },
  // 장기 기억: in a conversation, the chat's memory as sent; in a memory task, the memory the new records follow.
  memory: { wrapped: true, role: 'system', repeats: false, sorts: ['conversation', 'memory'] },
  span: { wrapped: true, role: 'user', repeats: false, sorts: ['memory'] },
} as const satisfies Record<string, ({ wrapped: true; role: Role } | { wrapped: false; role?: never }) & { repeats: boolean; sorts: readonly PromptSort[] }>;
export type SlotKind = keyof typeof SLOTS;
type Wrapped = { [K in SlotKind]: (typeof SLOTS)[K]['wrapped'] extends true ? K : never }[SlotKind];
export const isWrapped = (slot: SlotKind): slot is Wrapped => SLOTS[slot].wrapped;

export const slotsOf = (sort: PromptSort) => (Object.keys(SLOTS) as SlotKind[]).filter((slot) => (SLOTS[slot].sorts as readonly PromptSort[]).includes(sort));

// Counted in chat messages: a negative number counts from the end, and to null runs to the end.
// Past chat is {from: 0, to: -1}; the last message is {from: -1, to: null}.
export type ChatRange = { from: number; to: number | null };

// cache: 여기까지 캐시, a cache point on the last message sent up to and including this block.
type Named = { id: string; name: string | null; cache?: true };
// mark: the text a card replaces, main by its system prompt and globalNote by its post-history
// instructions, with {{original}} in the card's text standing for this block's text.
export type TextBlock = Named & { kind: 'text'; role: Role; text: string; mark: 'main' | 'globalNote' | null };
type WrappedFields = Named & { kind: 'slot'; role: Role; wrapper: string | null };
// count: how many messages before the source it holds. translations: false holds their originals only; absent holds
// each with its translation.
export type RecentSlot = WrappedFields & { slot: 'recent'; count: number; translations?: false };
export type WrappedSlot = (WrappedFields & { slot: Exclude<Wrapped, 'recent'> }) | RecentSlot;
export type ChatSlot = Named & { kind: 'slot'; slot: 'chat'; range: ChatRange };
export type PlainSlot = Named & { kind: 'slot'; slot: Exclude<SlotKind, Wrapped | 'chat'> };
export type Block = TextBlock | WrappedSlot | ChatSlot | PlainSlot;

// CBS requires string values: checks use '0'/'1', choices use the option index, text stays verbatim.
export type Toggle = { key: string; label: string } & (
  | { kind: 'check'; default: '0' | '1' }
  | { kind: 'choice'; options: string[]; default: string }
  | { kind: 'text'; lines?: true; default: string }
);

// Layout-only lines have no key and must never participate in toggle value lookup.
export type ToggleMark = { kind: 'divider'; label: string } | { kind: 'caption'; label: string } | { kind: 'group'; label: string } | { kind: 'groupEnd' };
// Preserve unparsed Risu lines verbatim for round-trip export and repair; never render them as controls.
export type UnreadLine = { kind: 'unread'; text: string };
export type ToggleLine = Toggle | ToggleMark | UnreadLine;
export const isToggle = (line: ToggleLine): line is Toggle => 'key' in line;

export type ToggleValues = Record<string, string>;

// Copies retain origin's captured name, but must not inherit imported. A chat note overrides authorNote.
export type ConversationPrompt = {
  task?: never;
  name: string;
  blocks: Block[];
  toggles: ToggleLine[];
  authorNote: string;
  models: Assignment;
  origin?: { id: string; name: string };
  imported?: 'risu-preset';
  // Only conversation prompts are filed (model/folders; user ruling, 2026-10-17).
  folder?: string;
  // The modules on in its chats, in the order they were turned on (design §6.5). One that is gone reads as off.
  modules?: string[];
  // Risu module ids/namespaces enable matching modules even when imported after the preset.
  companions?: string[];
  // 기능 in its chats, over the 공용 ones (runtime/features).
  features?: FeatureSwitches;
  // 에이전트 in its chats, stacked after 공용's (runtime/agents agentsOf).
  agents?: string[];
};

// Translation model falls back to the chat's auxiliary model. Text blocks have no card-replacement marks.
// protect regex sources use gu and join engine/protect spans passed through unchanged.
export type TranslatePrompt = {
  task: 'translate';
  name: string;
  model?: ModelRef;
  blocks: Block[];
  toggles: ToggleLine[];
  protect?: string[];
  origin?: { id: string; name: string };
};

// model: the one place the memory's model is chosen; without one, the chat's 보조 모델, then its 대화 모델.
export type MemoryPrompt = {
  task: 'memory';
  name: string;
  model?: ModelRef;
  blocks: Block[];
  toggles: ToggleLine[];
  origin?: { id: string; name: string };
};

// Danbooru-style tags, comma separated, put into every picture the prompt makes (engine/illustrate pictureRequest).
export type PictureTags = { artist: string; quality: string; negative: string };

// Absent settings use model defaults; absent seed rerolls each picture.
// normal is the only pixel tier eligible for NovelAI Opus free pictures.
export type PictureSize = 'normal' | 'large';
export type PictureSettings = { steps?: number; scale?: number; rescale?: number; sampler?: string; seed?: number; size?: PictureSize };

// Scene-model fallback: auxiliary, then chat model; image model comes from illustration switches.
// Absent tags use PICTURE_DEFAULTS, but empty tags send nothing.
export type IllustratePrompt = {
  task: 'illustrate';
  name: string;
  model?: ModelRef;
  tags?: PictureTags;
  picture?: PictureSettings;
  blocks: Block[];
  toggles: ToggleLine[];
  origin?: { id: string; name: string };
};

// model: the one place the mascot's model is chosen; without one, the chat's 보조 모델, then its 대화 모델.
export type MascotPrompt = {
  task: 'mascot';
  name: string;
  model?: ModelRef;
  blocks: Block[];
  toggles: ToggleLine[];
  origin?: { id: string; name: string };
};

// model: the one place the 토큰 절약 model is chosen; without one, the chat's 보조 모델, then its 대화 모델.
export type PrereadPrompt = {
  task: 'preread';
  name: string;
  model?: ModelRef;
  blocks: Block[];
  toggles: ToggleLine[];
  origin?: { id: string; name: string };
};

// Pre agents leave notes; post agents rewrite replies. Model fallback is auxiliary, then chat model.
// protect follows translation rules; absent place replaces text rather than adding before/after it.
export type AgentStage = 'pre' | 'post';
export type AgentPlace = 'before' | 'after';
export type AgentPrompt = {
  task: 'agent';
  name: string;
  stage: AgentStage;
  model?: ModelRef;
  blocks: Block[];
  toggles: ToggleLine[];
  protect?: string[];
  place?: AgentPlace;
  origin?: { id: string; name: string };
};

export type Prompt = (ConversationPrompt | TranslatePrompt | MemoryPrompt | IllustratePrompt | MascotPrompt | PrereadPrompt | AgentPrompt) & Mark;
export type PromptOf<S extends PromptSort> = { conversation: ConversationPrompt; translate: TranslatePrompt; memory: MemoryPrompt; illustrate: IllustratePrompt; mascot: MascotPrompt; preread: PrereadPrompt; agent: AgentPrompt }[S];

export const sortOf = (prompt: Prompt): PromptSort => prompt.task ?? 'conversation';
