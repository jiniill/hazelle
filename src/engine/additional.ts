import type { Vector } from '../model/memory';
import { speakersOf } from './memory';
import type { ChatScope } from './render';
import { rank } from './retrieval';

// A card's additionalText as Risu reads it (process/embedding/addinfo.ts): paragraphs split at a blank line, the three
// nearest the question sent after the description, nearest first. A paragraph of nothing but space is never asked for,
// and one written twice is one.
export const paragraphs = (text: string) => [...new Set(text.split('\n\n').filter((part) => part.trim()))];

// Risu asks with the chat's first four messages past the greeting, never its latest, so from the fifth on every send
// finds the same paragraphs and the description stays cacheable.
const ASKED = 4;
// Risu's own embedding model reads only the head of a long question; this head fits EMBED_TOKENS (runtime/models/embed) at
// two tokens a character.
const QUERY_MOST = 4000;
export function additionalQuery(scope: Pick<ChatScope, 'messages' | 'persona' | 'card' | 'greeting'>): string {
  const from = scope.greeting === null ? 0 : 1;
  const speakers = speakersOf(scope);
  return scope.messages
    .slice(from, from + ASKED)
    .map(({ text }, index) => `${speakers[from + index]}: ${text}`)
    .join('\n\n')
    .slice(0, QUERY_MOST);
}

export const ADDITIONAL_MOST = 3;
// items: by paragraph.
export const nearestParagraphs = (query: number[], items: Record<string, Vector>) => rank(query, items).slice(0, ADDITIONAL_MOST).map(({ id }) => id);
