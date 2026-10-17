import type { Assignment, ModelRef } from '../connectors/assignment';
import type { Mark } from './library';
import type { FeatureSwitches } from './features';

export type Role = 'system' | 'user' | 'assistant';

export type PromptSort = 'conversation' | 'translate' | 'memory' | 'illustrate' | 'mascot';

// A feature that brings something new to the prompt adds a row. wrapped: the slot takes a role and a 감싸는 텍스트 with
// {{slot}} where its content goes; role is the one a new block of it starts with (app/prompts/edits newBlock).
export const SLOTS = {
  tool: { wrapped: true, role: 'system', repeats: false, sorts: ['conversation'] },
  // 캐릭터 설명 and 페르소나 repeat because Risu presets put them in several places and open one by a toggle (누렁이's
  // 탈옥조정 for the description, 소악마's topbotpersona for the persona): with one place, the other toggle states send
  // nothing at all.
  description: { wrapped: true, role: 'system', repeats: true, sorts: ['conversation', 'translate', 'memory', 'illustrate'] },
  persona: { wrapped: true, role: 'system', repeats: true, sorts: ['conversation', 'translate', 'memory', 'illustrate'] },
  lorebook: { wrapped: false, repeats: false, sorts: ['conversation', 'translate', 'memory', 'illustrate'] },
  authorNote: { wrapped: true, role: 'system', repeats: false, sorts: ['conversation'] },
  postEverything: { wrapped: false, repeats: false, sorts: ['conversation'] },
  chat: { wrapped: false, repeats: true, sorts: ['conversation'] },
  note: { wrapped: true, role: 'system', repeats: false, sorts: ['translate'] },
  // 삽화 노트: a chat's own directions for its pictures (Chat.illustrateNote).
  illustrateNote: { wrapped: true, role: 'system', repeats: false, sorts: ['illustrate'] },
  recent: { wrapped: true, role: 'system', repeats: false, sorts: ['translate', 'illustrate', 'mascot'] },
  // In a 삽화 task, the message's paragraphs, numbered (model/illustration paragraphsOf); in a 마스코트 task, the reply as
  // shown.
  source: { wrapped: true, role: 'user', repeats: false, sorts: ['translate', 'illustrate', 'mascot'] },
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

// key is what conditions name ({{#when::toggle::key}}, toggle_key); label is what screens show. Values are
// strings because CBS reads them: a check is '1' or '0', a choice is its option's index, a text what was typed
// (lines: a box of several lines).
export type Toggle = { key: string; label: string } & (
  | { kind: 'check'; default: '0' | '1' }
  | { kind: 'choice'; options: string[]; default: string }
  | { kind: 'text'; lines?: true; default: string }
);

// A line of a toggle list that holds no value and only lays the list out: a group runs to its groupEnd, as in Risu.
// It has no key, so it never reaches what reads values (chatToggles, toggleValue).
export type ToggleMark = { kind: 'divider'; label: string } | { kind: 'caption'; label: string } | { kind: 'group'; label: string } | { kind: 'groupEnd' };
// A line of Risu's toggle text that reads as no toggle and no mark, kept as written so an export gives it back and the
// editor can fix it. It has no key either, and lays nothing out.
export type UnreadLine = { kind: 'unread'; text: string };
export type ToggleLine = Toggle | ToggleMark | UnreadLine;
export const isToggle = (line: ToggleLine): line is Toggle => 'key' in line;

// A character's or 캐릭터 없이's toggle values by key, over the declared defaults.
export type ToggleValues = Record<string, string>;

// authorNote is the default 작가의 노트, which a chat's own note replaces.
// origin is a copy's original, named as it was then. imported marks a prompt made from a Risu preset; a copy
// does not inherit it.
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
  // The modules its Risu preset named (moduleIntergration), each a Risu module id or namespace, so a module imported
  // after it is turned on for it too. Absent on a prompt made before it was kept.
  companions?: string[];
  // 기능 in its chats, over the 공용 ones (runtime/features).
  features?: FeatureSwitches;
};

// model: the one place a translation's model is chosen; without one, the chat's 보조 모델. Its text blocks carry no mark,
// since a card never replaces a translator's text.
export type TranslatePrompt = {
  task: 'translate';
  name: string;
  model?: ModelRef;
  blocks: Block[];
  toggles: ToggleLine[];
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

// How each picture is drawn, a field absent for the image model's own (connectors PictureRequest), seed absent for a
// new one each picture.
export type PictureSettings = { steps?: number; scale?: number; rescale?: number; sampler?: string; seed?: number };

// model: the one place the scene writer is chosen; without one, the chat's 보조 모델, then its 대화 모델. The picture's
// model is the chat's 삽화 switches' (runtime/characters illustrateSwitches). tags: absent reads as the app's
// (engine/illustrate PICTURE_DEFAULTS); an empty field sends none.
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

export type Prompt = (ConversationPrompt | TranslatePrompt | MemoryPrompt | IllustratePrompt | MascotPrompt) & Mark;
export type PromptOf<S extends PromptSort> = { conversation: ConversationPrompt; translate: TranslatePrompt; memory: MemoryPrompt; illustrate: IllustratePrompt; mascot: MascotPrompt }[S];

export const sortOf = (prompt: Prompt): PromptSort => prompt.task ?? 'conversation';
