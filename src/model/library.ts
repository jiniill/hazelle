export type PackOwner = { kind: 'character' | 'module'; id: string };
// A lorebook's owner: a pack's, or a chat's own (채팅 로어북), which owns no scripts, so PackOwner leaves it out.
export type LoreOwner = { kind: PackOwner['kind'] | 'chat'; id: string };
import type { FileRef } from '../vault/files';
import type { Card, LoreEntry, Pack } from '../engine/import/types';
import type { Translation, TranslateSwitches } from './chat';
import type { FeatureSwitches } from './features';
import type { IllustrateSwitches } from './illustration';
import type { Stored } from './kinds';
import type { ToggleValues } from './prompt';

// loreFolders only group its lorebook on screen.
// origin is the character it was copied from, named as it was then, so a gone origin can still be named.
// alias: 별명, the user's own note to tell apart characters (or personas) of one name. It is never sent, unlike the
// card's nickname (부르는 이름), which CCv3 puts in {{char}}'s place.
export type Character = Mark & {
  card: Card;
  alias?: string;
  folder: string | null;
  loreFolders: LoreFolder[];
  origin?: { id: string; name: string };
  toggles?: ToggleValues;
  // 고정 페르소나: the persona its chats use in place of the default, unless a chat picks its own.
  persona?: string;
  // 이 캐릭터만 따로: its chats' translation switches in place of the shared Settings.translate.
  ownTranslate?: TranslateSwitches;
  // 번역가의 노트: added to the 전역 one (Settings.translatorNote), never replacing it as the switches do.
  translatorNote?: string;
  // 이 캐릭터만 따로: its chats' 삽화 switches in place of the shared Settings.illustrate.
  ownIllustrate?: IllustrateSwitches;
  // 봇 스타일: false shows the chats' messages without the bot's HTML and CSS. Absent is on.
  decor?: boolean;
  // Whether the bot's Lua may call models, which costs the user. Absent: not asked yet, and the first call asks.
  botModels?: boolean;
  // Whether the scripts of its chats, its modules' included, may rewrite its card (setBackgroundEmbedding). Asked once
  // per character, not per script. Absent: not asked yet, and the first write asks.
  cardWrites?: boolean;
  pictures?: Pictures;
  // 상태창 지정: the display scripts, by id in card.regex, whose boxes are the character's status window, shown once
  // for the latest message instead of in every one. An id that names no script marks nothing, so a deleted script's
  // 되돌리기 brings its mark back.
  statusScripts?: string[];
  // 추론을 본문에 표시: its replies keep the thinking blocks they write inside the text (connectors/thoughts) where they
  // are, for a bot that draws them itself. Absent: they move to the reply's reasoning.
  keepThoughts?: true;
  // Translations of the card's readable texts (readableTexts), keyed by the text as the card holds it and the
  // language, so an edited text or a changed language translates anew. A chat not begun shows its greetings' here.
  translations?: TextTranslation[];
  // The Risu chaId of a character brought from Risu: a move skips it, and 이미지만 가져오기 finds it.
  risu?: string;
  // The modules on in its chats, in the order they were turned on (design §6.5). One that is gone reads as off.
  modules?: string[];
  // 기능 in its chats, over its chats' prompt's (runtime/features).
  features?: FeatureSwitches;
  // 에이전트 in its chats, stacked after its chats' prompt's (runtime/agents agentsOf).
  agents?: string[];
};

// Lore/assets remain owned children. namespace serves {{moduleenabled}}; risu keeps exported identity for move/charx pairing.
// takesMemory replaces built-in memory; network covers relay fetches and frame pictures/fonts.
// Absent consent fields mean not asked, never implicitly allowed.
export type Module = Pack & Mark & {
  botModels?: boolean;
  takesMemory?: boolean;
  network?: boolean;
  name: string;
  description: string;
  namespace: string | null;
  loreFolders: LoreFolder[];
  risu?: string;
  folder?: string;
};
// fold false shows such a picture whole instead of its top until opened. peek is the height its top shows at, in percent
// of the screen's height; widest the width no such picture is drawn wider than, in percent of the text's width.
export type Pictures = { fold?: false; peek?: number; widest?: number };
export const PICTURE_PERCENT = { min: 10, max: 100 };
export type TextTranslation = { source: string; language: string; translation: Translation };
export type LoreFolder = { id: string; name: string };

const DAY = 24 * 60 * 60 * 1000;

// Binned objects stay recoverable for KEEP_DELETED; characters own their chats, and binned modules are inactive.
// purging makes removal irreversible; purgeExpired resumes interrupted purges (runtime/characters).
export const REMOVABLE = ['character', 'module', 'chat', 'prompt', 'persona', 'profile'] as const;
export type Removable = (typeof REMOVABLE)[number];
export type Mark = { deleted?: number; purging?: true };

// Whether it is out of 휴지통, and whether 휴지통 shows it: one being removed for good (purging) is neither.
export const isLive = ({ deleted }: Mark) => deleted === undefined;
export const isBinned = ({ deleted, purging }: Mark) => deleted !== undefined && !purging;

// A stored object as every reader but its removal and its undo sees it: null while it is in 휴지통.
export const live = <T extends { value: Mark }>(stored: T | null): T | null => (stored && isLive(stored.value) ? stored : null);

export const binned = <T extends { value: Mark }>(items: T[]): T[] => items.filter(({ value }) => isBinned(value)).sort((a, b) => b.value.deleted! - a.value.deleted!);

// One of a deleted character is not listed: it goes or comes back with its character.
export const binsChat = (chat: { character: string | null } & Mark, characterLive: (id: string) => boolean) =>
  isBinned(chat) && (chat.character === null || characterLive(chat.character));

export const KEEP_DELETED = 7 * DAY;
export const KEEP_DAYS = KEEP_DELETED / DAY;

export const textTranslation = ({ translations }: Character, source: string, language: string) =>
  translations?.find((each) => each.source === source && each.language === language)?.translation;

export const readableTexts = (card: Card) =>
  [card.creatorNotes, card.description, card.personality, card.scenario, card.exampleDialogue, ...card.greetings].filter((text) => text.trim());

export const daysLeft = ({ deleted }: Mark, now: number) => Math.ceil((deleted! + KEEP_DELETED - now) / DAY);

export const characterTexts = ({ card, alias }: Character) => [card.name, card.nickname ?? '', alias ?? ''];

export type Lore = Omit<LoreEntry, 'folder'> & { folder: string | null };

// thumb: a small copy that syncs with the objects, so lists need no file fetch.
export type Avatar = { type: string; size: number; thumb: string; file: FileRef };

// Kind `asset`, whose parent is the character or module (design §6.4). type is what the bytes are, read from them.
export type Asset = { name: string; type: string; size: number; file: FileRef };

// Kind `inlay`, a chat's own picture, which its messages name by name ({{inlay::name}}). attached: the user put it in
// the composer, so it goes to a model that sees pictures; absent, it came with a chat brought from Risu and goes only
// where the chat's movedPictures is on.
export type Inlay = Asset & { attached?: true };

// Kind `textfile`, a text file the user put in the composer, which its message names by name ({{textfile::name}}) and
// which goes to the model with that message (engine/pipeline). title: the file's own name.
export type TextFile = { name: string; title: string; text: string };

// A character with its chats, or (id null) the chats that have no character: 캐릭터 없이. face: the avatar's thumbnail;
// avatar: its id, whose file is the picture at full size.
export type Shelf<C> = { id: string | null; character: Character | null; face: string | null; avatar: string | null; chats: C[] };
export type CharacterShelf<C> = Shelf<C> & { id: string; character: Character };

type ChatLike = { chat: { character: string | null } & Mark; order: number };

// chats must arrive newest first. Rank characters by their latest chat, never their edit-sensitive rev;
// chatless characters follow by name (user ruling, 2026-10-08). Purging objects must stay out of all lists.
export function shelve<C extends ChatLike>(
  characters: Stored<'character'>[],
  avatars: Stored<'avatar'>[],
  chats: C[],
  binned: C[],
): { characters: CharacterShelf<C>[]; none: Shelf<C>; deleted: CharacterShelf<C>[]; deletedChats: C[] } {
  const avatarOf = new Map(avatars.map((avatar) => [avatar.parent, avatar]));
  const grouped = new Map<string | null, C[]>();
  for (const item of chats) {
    const own = grouped.get(item.chat.character);
    if (own) own.push(item);
    else grouped.set(item.chat.character, [item]);
  }
  const shelves = characters.map(({ id, value }) => ({ id, character: value, face: avatarOf.get(id)?.value.thumb ?? null, avatar: avatarOf.get(id)?.id ?? null, chats: grouped.get(id) ?? [] }));
  const loose = grouped.get(null) ?? [];
  const live = shelves.filter((shelf) => isLive(shelf.character));
  const liveIds = new Set(live.map((shelf) => shelf.id));
  return {
    characters: live.sort((a, b) => (b.chats[0]?.order ?? 0) - (a.chats[0]?.order ?? 0) || a.character.card.name.localeCompare(b.character.card.name, 'ko')),
    none: { id: null, character: null, face: null, avatar: null, chats: loose },
    deleted: shelves.filter((shelf) => isBinned(shelf.character)).sort((a, b) => b.character.deleted! - a.character.deleted!),
    deletedChats: binned
      .filter(({ chat }) => binsChat(chat, (id) => liveIds.has(id)))
      .sort((a, b) => b.chat.deleted! - a.chat.deleted!),
  };
}
