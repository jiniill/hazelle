import { expect, test } from 'vitest';
import { folds, nextFold, type Fold, type FoldEvent } from './useComposerFold';

const after = (...events: FoldEvent[]) => events.reduce(nextFold, { wants: false, opened: false } satisfies Fold);

test('a composer being typed in folds when the story is scrolled away, and opens on a press or a key', () => {
  const typing = after('open');
  expect(folds(after('open', { wants: true }))).toBe(true);
  expect(folds(nextFold(typing, { wants: true }))).toBe(true);
  expect(folds(after({ wants: true }, 'open'))).toBe(false);
});

test('opened while away, it folds again only when the reader moves the story or the next fold begins', () => {
  const opened = after({ wants: true }, 'open');
  expect(folds(nextFold(opened, { wants: true }))).toBe(false);
  expect(folds(nextFold(opened, 'read'))).toBe(true);
  expect(folds(after({ wants: true }, 'open', { wants: false }, { wants: true }))).toBe(true);
});
