import { lorebookSource, nativeHolds, type Json } from './convert';
import type { LoreEntry } from './types';

// Inverse of risu-character risuChat: greeting indexes the card (0 = first_mes), messages exclude it.
// Texts are post-script; variables are end-of-line state. Risu replaces the exported chat id on import.
export type RisuChatSource = {
  id: string;
  title: string;
  note: string;
  greeting: number | null;
  messages: { id: string; role: 'user' | 'assistant'; text: string; at: number; reasoning?: string }[];
  variables: [string, string][];
  bookmarks: { message: string; name?: string }[];
  lore: LoreEntry[];
  loreFolders: string[];
};

// unheld: the lore entries Risu's lorebook cannot hold whole, which are left out.
export function risuChat({ id, title, note, greeting, messages, variables, bookmarks, lore, loreFolders }: RisuChatSource): { chat: Json; unheld: number } {
  const held = lore.filter(nativeHolds);
  const line = new Set(messages.map((message) => message.id));
  const marked = bookmarks.filter(({ message }) => line.has(message));
  return {
    chat: {
      id,
      name: title,
      note,
      // Risu draws the greeting from fmIndex, never as a message; its -1 is first_mes.
      fmIndex: greeting === null ? -1 : greeting - 1,
      message: messages.map(({ id, role, text, at, reasoning }) => ({
        role: role === 'user' ? 'user' : 'char',
        // Risu's own form of a reply's reasoning, which it takes out before it draws or sends the text.
        data: reasoning ? `<Thoughts>\n\n${reasoning}\n\n</Thoughts>\n${text}` : text,
        time: at,
        chatId: id,
      })),
      localLore: lorebookSource(held, loreFolders),
      // Risu reads a chat variable only under its $ name.
      scriptstate: Object.fromEntries(variables.map(([name, value]) => [`$${name}`, value])),
      bookmarks: marked.map(({ message }) => message),
      bookmarkNames: Object.fromEntries(marked.flatMap(({ message, name }) => (name ? [[message, name]] : []))),
    },
    unheld: lore.length - held.length,
  };
}

// Risu's ver-2 import checks type and ver only; folders is this app's none.
export const risuChatJson = (chat: Json) => JSON.stringify({ type: 'risuChat', ver: 2, data: chat, folders: [] });

// A character's chats, written chat by chat between head and tail, joined by commas.
export const RISU_ALL_CHATS = { head: '{"type":"risuAllChats","ver":2,"folders":[],"data":[', tail: ']}' } as const;
