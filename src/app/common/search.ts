import type { Marked } from '../ui';

export const noResults = (words: string) => `'${words}' 검색 결과가 없어요.`;

export const SEARCH_FROM = 8;

// The text with the words lit where matches finds them in it; the text alone where it finds them elsewhere.
export function litIn(text: string, words: string): Marked {
  const sought = words.trim().toLowerCase();
  const from = text.toLowerCase().indexOf(sought);
  return from < 0 ? text : { text, from, to: from + sought.length };
}

export const matches = (words: string, ...texts: string[]) => texts.join(' ').toLowerCase().includes(words.trim().toLowerCase());
