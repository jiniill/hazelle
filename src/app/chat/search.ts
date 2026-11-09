import type { Version } from '../../model/chat';
import { foldTerm, foldText } from '../../model/search';

// What a message's version reads as: its translation unless flipped to the original, or the translation streaming in.
// original: its text as the display shows it. shownTranslation: the translation as the display shows it (runtime/translate).
export function seenText(original: string, version: Version, translating: string | null, flipped: boolean, shownTranslation: (text: string) => string) {
  const translation = translating || version.translation?.text;
  return flipped || translation === undefined ? original : shownTranslation(translation);
}

// Cache each text's folded search by identity/content so streaming a long chat only refolds changed messages.
export function finder() {
  let folds = new Map<string, string>();
  let asked = '';
  let answers = new Map<string, boolean>();
  return (texts: readonly string[], term: string): number[] => {
    const folded = foldTerm(term);
    if (!folded) return [];
    if (folded !== asked) answers = new Map();
    asked = folded;
    const nextFolds = new Map<string, string>();
    const nextAnswers = new Map<string, boolean>();
    const hits: number[] = [];
    texts.forEach((text, index) => {
      const plain = folds.get(text) ?? foldText(text);
      const hit = answers.get(text) ?? plain.includes(folded);
      nextFolds.set(text, plain);
      nextAnswers.set(text, hit);
      if (hit) hits.push(index);
    });
    folds = nextFolds;
    answers = nextAnswers;
    return hits;
  };
}
