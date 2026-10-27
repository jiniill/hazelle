// A particle pair: the first form after a final consonant, the second after a vowel. 으로/로 also takes 로 after ㄹ.
type Pair = '이/가' | '을/를' | '은/는' | '과/와' | '으로/로' | '이라서/라서';

// Multi-digit trailing zero reads as a unit (십/백/천/만), with a non-ㄹ final consonant like 영.
const DIGIT_FINALS = [21, 8, 0, 16, 0, 0, 1, 8, 8, 0];

// Return Hangul final consonant (0 none, 8 ㄹ), null for unknown pronunciation.
// Ignore closing quotes/brackets so quoted labels use their last spoken syllable.
function finalOf(word: string): number | null {
  const last = word.replace(/['")\]’”]+$/, '').at(-1);
  if (last === undefined) return null;
  if (last >= '0' && last <= '9') return DIGIT_FINALS[Number(last)]!;
  const code = last.charCodeAt(0) - 0xac00;
  return code >= 0 && code < 11172 ? code % 28 : null;
}

// The particle alone, for a sentence that renders the word apart from it. When the sound is not known it reads
// both forms: 이(가), 을(를), (으)로.
export function particleOf(word: string, pair: Pair): string {
  const [closed, open] = pair.split('/') as [string, string];
  const final = finalOf(word);
  if (final === null) return closed.endsWith(open) ? `(${closed.slice(0, -open.length)})${open}` : `${closed}(${open})`;
  return final === 0 || (final === 8 && pair === '으로/로') ? open : closed;
}

export const withParticle = (word: string, pair: Pair): string => word + particleOf(word, pair);
