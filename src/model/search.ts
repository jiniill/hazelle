import { shown, type Message } from './chat';

// Only what is shaped like a tag, so prose such as "a < b > c" keeps its words.
const TAG = /<\/?[a-z][^>]*>/gi;
// How much of a long text stands before its hit and after it: a line or two of a result's row.
const LEAD = 24;
const TAIL = 160;

export const foldTerm = (term: string) => term.trim().normalize('NFC').toLowerCase();

const plain = (text: string) => text.replace(TAG, '').normalize('NFC');

// The one rule both searches read a text by: the in-chat search (app/chat/search) and the one over every chat.
export const foldText = (text: string) => plain(text).toLowerCase();

// The stretch of a text around its first hit; from and to are the hit's place in it.
export type Lit = { text: string; from: number; to: number };

// term: folded (foldTerm). A character whose lower case is longer (İ) shifts what is lit after it, never what is found.
export function litIn(text: string, term: string): Lit | null {
  const read = plain(text);
  const at = read.toLowerCase().indexOf(term);
  if (at < 0) return null;
  const start = at > LEAD ? at - LEAD : 0;
  const lead = start ? '…' : '';
  const from = lead.length + at - start;
  return { text: lead + read.slice(start, at + term.length + TAIL), from, to: from + term.length };
}

// count: the messages holding the term, as the in-chat search counts its hits; message: the first of them.
export type MessageHit = { message: string; count: number; lit: Lit };

// Each message's shown version, its text and its translation, as stored with only what named fills in: the rest of what
// the display makes of them is not read.
export function findInMessages(messages: readonly Message[], term: string, named: (text: string) => string): MessageHit | null {
  let first: Omit<MessageHit, 'count'> | null = null;
  let count = 0;
  for (const message of messages) {
    const { text, translation } = shown(message);
    const lit = litIn(named(text), term) ?? (translation ? litIn(named(translation.text), term) : null);
    if (!lit) continue;
    count++;
    first ??= { message: message.id, lit };
  }
  return first && { ...first, count };
}
