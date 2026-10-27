import type { Receipt } from './chat';

// One atomic memory object per chat at memoryId(chat), preventing duplicate span commits across devices.
// Records plus the uncovered raw messages must represent the whole chat.

// Token counts use prompt-rendered text. window keeps whole recent messages raw, always including the last.
// batch triggers summaries outside that window and bounds their size, except for one oversized message.
export type MemorySettings = { on: boolean; budget: number; window: number; batch: number };

export type Source = { message: string; version: string };

export type Line = { speaker: string; text: string };

// Never invent when/where; quote lines verbatim with speakers. print fingerprints prompt-rendered source.
// Automatic work must not rewrite edited/pinned records. Forgotten spans stay covered until explicitly retried.
// receipt is null for user-authored records.
export type Written = {
  id: string;
  sources: Source[];
  print: string;
  when: string | null;
  where: string | null;
  who: string[];
  what: string;
  lines: Line[];
  outcome: string;
  receipt: Receipt | null;
  at: number;
  edited?: true;
  pinned?: true;
  forgotten?: true;
};

// Remove facts only through explicit null-valued state changes.
// recalled sends source messages while they fit and, like pinned, is user-owned.
export type MemoryRecord = Written & { state: Change[]; opens: string[]; closes: string[]; recalled?: true };

// Chapters resummarize original messages, never record text or another chapter.
// Changed record timestamps require user intervention before replacing a chapter.
export type Chapter = Written & { records: { id: string; at: number }[] };

export type Change = { about: string; field: string; value: string | null };

// The old value lives on in the record that changed it. record: the record that last set it, null when the user did.
export type Fact = { about: string; field: string; value: string; record: string | null };

// opened: the record that opened it, null when the user did.
export type Thread = { id: string; text: string; opened: string | null };

export type Memory = { records: MemoryRecord[]; chapters: Chapter[]; state: Fact[]; threads: Thread[] };

export const emptyMemory = (): Memory => ({ records: [], chapters: [], state: [], threads: [] });

export const inverted = (group: string) => [...group].map((digit) => (15 - parseInt(digit, 16)).toString(16)).join('');

// Deterministic id makes concurrent device creation conflict instead of duplicating memory.
export const memoryId = (chat: string) => chat.replace(/^[0-9a-f]{8}/, inverted);

// Rebuildable per-chat embeddings: never compare vectors from different models.
// Record id + at invalidates edits/remakes. Unit vectors use signed-byte quantization at scale (base64 data).
export type Vector = { at: number; scale: number; data: string };
export type Vectors = { model: string; items: Record<string, Vector> };

// The chat's id with its last group's hex digits inverted, as memoryId inverts the first.
export const vectorsId = (chat: string) => chat.replace(/[0-9a-f]{12}$/, inverted);
