// Escaped punctuation uses U+E9B8 onward in this order. Keep braces escaped through every CBS/regex pass;
// unescapeCbs runs only once at the end.
const PUNCTUATION = '{}()<>:;';
const FIRST = 0xe9b8;
const ESCAPED = /[-]/g;

export function escapeCbs(text: string, chars = PUNCTUATION): string {
  return [...text].map((char) => (chars.includes(char) ? String.fromCharCode(FIRST + PUNCTUATION.indexOf(char)) : char)).join('');
}

// Run on text just before it is sent or shown, after every CBS pass and regex stage.
export function unescapeCbs(text: string): string {
  return text.replace(ESCAPED, (char) => PUNCTUATION[char.charCodeAt(0) - FIRST]!);
}
