import type { Receipt } from './chat';
import { inverted } from './memory';

// One profile per pack at likenessId(owner); regenerate only on explicit request, not per picture.

// metadata: read from NovelAI's own prompt kept in the pack's pictures; vision: a model looked at them; text: written
// from the description and lorebook alone; user: added or edited by hand, which 다시 만들기 keeps.
export type BuiltSource = 'metadata' | 'vision' | 'text';
export type PortraitSource = BuiltSource | 'user';
export type Outfit = { name: string; tags: string };

// Match aliases like names; resolve scene outfit names to tags, defaulting to the first outfit.
// artist contains only known tags from the bot's pictures.
export type Portrait = { name: string; aliases: string[]; look: string; outfits: Outfit[]; artist: string; source: PortraitSource };

// receipt: the call that wrote it. portraits empty: the pack describes no one's looks, which is kept so no draw asks again.
export type Likeness = { portraits: Portrait[]; at: number; receipt: Receipt | null };

// Ruled 2026-10-11: the characters past this are written per scene, as before profiles.
export const PORTRAITS_MOST = 8;

// Deterministic id makes concurrent creation conflict instead of duplicating profiles; same scheme as memoryId.
export const likenessId = (owner: string) => owner.replace(/^([0-9a-f]{8}-)([0-9a-f]{4})/, (_, head: string, group: string) => head + inverted(group));
