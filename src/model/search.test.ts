import { expect, it } from 'vitest';
import type { Message } from './chat';
import { findInMessages, foldTerm, litIn } from './search';

const said = (id: string, text: string, translation?: string): Message => ({ id, role: 'assistant', at: 0, selected: 0, versions: [{ id, seed: '', text, receipt: null, edited: false, at: 0, ...(translation && { translation: { text: translation, receipt: null, at: 0 } }) }] });

it('finds a term in each shown version or its translation, tags left out, and lights the first around its hit', () => {
  const term = foldTerm(' Dragon ');
  expect(litIn('<b class="dragon">a</b> red DRA<i>gon</i>', term)).toEqual({ text: 'a red DRAgon', from: 6, to: 12 });
  const far = litIn(`${'x'.repeat(40)}dragon`, term)!;
  expect(far.text.slice(far.from, far.to)).toBe('dragon');
  expect(far.text.startsWith('…')).toBe(true);
  const messages = [said('a', 'nothing'), said('b', '원문', 'the dragon'), said('c', 'dragon again')];
  expect(findInMessages(messages, term, (text) => text)).toEqual({ message: 'b', count: 2, lit: { text: 'the dragon', from: 4, to: 10 } });
  expect(findInMessages(messages, foldTerm('용'), (text) => text)).toBeNull();
});
