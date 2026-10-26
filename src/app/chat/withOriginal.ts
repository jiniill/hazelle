import { isParagraph, paragraphsOf, withoutMarks } from '../../model/illustration';
import { ORIGINAL_MARK } from '../ui';

// 원문 함께 보기: each paragraph of the drawn translation followed by the originals it is aligned with, a blank line on
// either side so each stands as a block of its own; a picture's mark after its paragraph comes after them. The
// translator merges, splits, drops and adds paragraphs (translate-instructions: structure deviation is encouraged), so
// equal counts prove no pairing: every original is shown once, under the paragraph it aligns with, or under the one
// before it where the translation has none for it.
export function withOriginal(drawn: string, original: string): string {
  const lines = drawn.split('\n');
  const paragraph = (line: string) => isParagraph(withoutMarks(line));
  const under = aligned(lines.filter(paragraph).map((line) => withoutMarks(line).trim()), paragraphsOf(original));
  const shown = (originals: string[]) => originals.map((each) => `\n${each}${ORIGINAL_MARK}\n`);
  let seen = 0;
  return [...shown(under[0]!), ...lines.flatMap((line) => (paragraph(line) ? [line, ...shown(under[++seen]!)] : [line]))].join('\n');
}

// Each step takes [translated, original] paragraphs and costs its own beyond how far the lengths are off: a paragraph
// left alone is rarer than two merged, which are rarer than a pair.
const STEPS = [[1, 1, 0], [2, 1, 3], [1, 2, 3], [1, 0, 5], [0, 1, 5]] as const;
// How loosely a translated paragraph's length follows its original's.
const SPREAD = 2;
// A line of speech translated as narration, or the other way round.
const QUOTE_OFF = 2;
const QUOTED = /^[*_~\s]*["“”「『]/;
const size = (text: string) => text.replace(/<[^>]*>/g, '').length;

// By lengths, quotes and lines kept verbatim (headings the instructions keep), the cheapest way through both sides;
// under[0]: the originals before the first translated paragraph, under[k]: those after the k-th.
function aligned(translated: string[], originals: string[]): string[][] {
  const ratio = translated.reduce((sum, each) => sum + size(each), 0) / Math.max(1, originals.reduce((sum, each) => sum + size(each), 0));
  const cost = (i: number, j: number, take: number, give: number, alone: number) => {
    if (!take || !give) return alone;
    const ours = translated.slice(i, i + take);
    const theirs = originals.slice(j, j + give);
    if (take === 1 && give === 1 && ours[0] === theirs[0]) return 0;
    const length = ours.reduce((sum, each) => sum + size(each), 0);
    const expected = ratio * theirs.reduce((sum, each) => sum + size(each), 0);
    const off = (length - expected) / Math.sqrt((SPREAD * (length + expected)) / 2 + 1);
    return alone + (off * off) / 2 + (QUOTED.test(ours[0]!) === QUOTED.test(theirs[0]!) ? 0 : QUOTE_OFF);
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
