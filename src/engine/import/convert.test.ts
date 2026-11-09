import { expect, it } from 'vitest';
import { bookLorebook, chatLorebook, DEFAULT_ORDER } from './convert';

it('reads a null insertion order as 0, where Risu sorts it, and a missing one as a new entry’s', () => {
  expect(chatLorebook([{ key: 'a', insertorder: null }, { key: 'b' }]).lore.map(({ insertionOrder }) => insertionOrder)).toEqual([0, DEFAULT_ORDER]);
  expect(bookLorebook([{ keys: ['a'], insertion_order: null }]).lore.map(({ insertionOrder }) => insertionOrder)).toEqual([0]);
});
