import { isParagraph, withoutMarks } from '../../model/illustration';

// Lines of a text, both ends included.
export type Part = { from: number; to: number };

// Where a part being edited stands in the drawn text, swapped for the edit box. Not illustration's mark, which
// withoutMarks would take out.
export const PART_MARK = '\uE002';

// What a line reads as once drawn: markdown drops its marks and the story its tags, so only letters and digits count.
const PIECES = /<[^>]*>|[\s\S]/gu;
const LETTER = /^[\p{L}\p{N}]$/u;
const drawn = (text: string) => [...text.matchAll(PIECES)].filter(([piece]) => LETTER.test(piece));
const letters = (text: string) => drawn(text).map(([piece]) => piece).join('');

// The paragraphs of text from where the first piece is to where the last is, each piece a run of drawn text; null when
// a piece is in no paragraph, or the run could start in more than one.
export function partOf(text: string, pieces: string[]): Part | null {
  const wanted = pieces.map(letters).filter(Boolean);
  if (!wanted.length) return null;
  const [first, last] = [wanted[0]!, wanted.at(-1)!];
  const paragraphs = text.split('\n').flatMap((line, index) => (isParagraph(line) ? [{ index, letters: letters(line) }] : []));
  const found = paragraphs.flatMap((start, at) => {
    if (!start.letters.includes(first)) return [];
    const end = wanted.length === 1 ? start : paragraphs.slice(at + 1).find(({ letters }) => letters.includes(last));
    return end ? [{ from: start.index, to: end.index }] : [];
  });
  return found.length === 1 ? found[0]! : null;
}

export const linesOf = (text: string, { from, to }: Part) => text.split('\n').slice(from, to + 1).join('\n');

// An emptied part goes with its line.
export function withPart(text: string, { from, to }: Part, value: string): string {
  const lines = text.split('\n');
  return [...lines.slice(0, from), ...(value === '' ? [] : [value]), ...lines.slice(to + 1)].join('\n');
}

// The drawn text with the part's lines as one mark; a picture's mark among them stays.
export function markPart(text: string, { from, to }: Part): string {
  const lines = text.split('\n');
  return [...lines.slice(0, from), PART_MARK, ...lines.slice(from, to + 1).filter((line) => withoutMarks(line) !== line), ...lines.slice(to + 1)].join('\n');
}

// A key typed where a selection starts, before being the drawn text ahead of it in its paragraph: the drawn text keeps
// no source offsets, so the caret goes before the source letter that as many letters as before holds come ahead of, or
// at the end.
export function typeAt(value: string, before: string, key: string): { value: string; caret: number } {
  const at = drawn(value)[letters(before).length]?.index ?? value.length;
  return { value: value.slice(0, at) + key + value.slice(at), caret: at + key.length };
}
