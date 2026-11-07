import { isParagraph, paragraphsOf, withoutMarks } from '../../model/illustration';
import { ORIGINAL_MARK } from '../ui';

// Never pair by paragraph count alone: translation may merge/split/add/drop.
// Show each original exactly once under its best alignment, or the preceding translation when omitted.
// Keep picture marks after the paired blocks, separated by blank lines.
export function withOriginal(drawn: string, original: string): string {
  const lines = drawn.split('\n');
  const paragraph = (line: string) => isParagraph(withoutMarks(line));
  const under = aligned(lines.filter(paragraph).map((line) => withoutMarks(line).trim()), paragraphsOf(original));
  const shown = (originals: string[]) => originals.map((each) => `\n${each}${ORIGINAL_MARK}\n`);
  let seen = 0;
  return [...shown(under[0]!), ...lines.flatMap((line) => (paragraph(line) ? [line, ...shown(under[++seen]!)] : [line]))].join('\n');
}

// Each step takes [translated, original] paragraphs and costs its own beyond how far they are off: a paragraph left
// alone is rarer than two merged, which are rarer than a pair, and each more paragraph merged costs as one more merge.
// Up to MOST on one side: a translation into Korean breaks a paragraph of speech, its tag, more speech and narration
// into a line each. MOST bounds the work, done on every draw of a message.
const MERGE_OFF = 3;
const ALONE_OFF = 5;
const MOST = 4;
const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  ...Array.from({ length: MOST - 1 }, (_, at) => at + 2).flatMap((many) => [[many, 1, MERGE_OFF * (many - 1)], [1, many, MERGE_OFF * (many - 1)]] as const),
  [1, 0, ALONE_OFF],
  [0, 1, ALONE_OFF],
];
// How loosely a translated paragraph's length follows its original's.
const SPREAD = 2;
// Speech on one side of a step and none on the other. Anywhere in the step, not at its start: a translation may put
// the tag before the speech when it merges them.
const QUOTE_OFF = 2;
const QUOTE = /["“”「『]/;
// Each number or Latin word that both texts hold, standing on one side of a step only.
const WORD_OFF = 1;
const WORDS = /\d+|[a-z]{3,}/g;
// Each question mark, exclamation mark or ellipsis more on one side of a step.
const MARK_OFF = 0.5;
const MARKS = [/[?？]/g, /[!！]/g, /…|\.{3}/g];
const bare = (text: string) => text.replace(/<[^>]*>/g, '');
type Traits = { size: number; words: string[]; marks: number[]; speech: boolean };
const traitsOf = (text: string): Traits => {
  const plain = bare(text);
  return { size: plain.length, words: plain.toLowerCase().match(WORDS) ?? [], marks: MARKS.map((mark) => plain.match(mark)?.length ?? 0), speech: QUOTE.test(plain) };
};
const sizeOf = (group: Traits[]) => group.reduce((sum, each) => sum + each.size, 0);
const wordsOf = (group: Traits[]) => new Set(group.flatMap((each) => each.words));
const marksOf = (group: Traits[]) => MARKS.map((_, at) => group.reduce((sum, each) => sum + each.marks[at]!, 0));
const spoken = (group: Traits[]) => group.some((each) => each.speech);

// By lengths, quotes, carried words and marks, and lines kept verbatim (headings the instructions keep), the cheapest
// way through both sides; under[0]: the originals before the first translated paragraph, under[k]: those after the k-th.
function aligned(translated: string[], originals: string[]): string[][] {
  const [ourTraits, theirTraits] = [translated.map(traitsOf), originals.map(traitsOf)];
  const ratio = sizeOf(ourTraits) / Math.max(1, sizeOf(theirTraits));
  // Only words found on both sides tell paragraphs apart: an English translation's words are no Korean original's.
  const theirWords = wordsOf(theirTraits);
  const carried = new Set([...wordsOf(ourTraits)].filter((word) => theirWords.has(word)));
  for (const each of [...ourTraits, ...theirTraits]) each.words = each.words.filter((word) => carried.has(word));
  const cost = (i: number, j: number, take: number, give: number, alone: number) => {
    const ours = ourTraits.slice(i, i + take);
    const theirs = theirTraits.slice(j, j + give);
    if (take === 1 && give === 1 && translated[i] === originals[j]) return 0;
    const [mine, others] = [wordsOf(ours), wordsOf(theirs)];
    const lone = [...mine].filter((word) => !others.has(word)).length + [...others].filter((word) => !mine.has(word)).length;
    const [ourMarks, theirMarks] = [marksOf(ours), marksOf(theirs)];
    const marks = ourMarks.reduce((sum, count, at) => sum + Math.abs(count - theirMarks[at]!), 0);
    const told = alone + lone * WORD_OFF + marks * MARK_OFF;
    if (!take || !give) return told;
    const length = sizeOf(ours);
    const expected = ratio * sizeOf(theirs);
    const off = (length - expected) / Math.sqrt((SPREAD * (length + expected)) / 2 + 1);
    return told + (off * off) / 2 + (spoken(ours) === spoken(theirs) ? 0 : QUOTE_OFF);
  };
  const width = originals.length + 1;
  const best = new Float64Array((translated.length + 1) * width).fill(Infinity);
  const from = new Uint8Array(best.length);
  best[0] = 0;
  for (let i = 0; i <= translated.length; i++) {
    for (let j = 0; j <= originals.length; j++) {
      const here = best[i * width + j]!;
      if (here === Infinity) continue;
      STEPS.forEach(([take, give, alone], step) => {
        if (i + take > translated.length || j + give > originals.length) return;
        const there = (i + take) * width + j + give;
        const total = here + cost(i, j, take, give, alone);
        if (total < best[there]!) [best[there], from[there]] = [total, step];
      });
    }
  }
  const under = Array.from({ length: translated.length + 1 }, (): string[] => []);
  for (let i = translated.length, j = originals.length; i || j; ) {
    const [take, give] = STEPS[from[i * width + j]!]!;
    i -= take;
    j -= give;
    under[i + take]!.unshift(...originals.slice(j, j + give));
  }
  return under;
}
