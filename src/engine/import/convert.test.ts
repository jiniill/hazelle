import { expect, it } from 'vitest';
import { bookLorebook, chatLorebook, DEFAULT_ORDER, withoutStyles } from './convert';

it('strips what the style and comment regex strips, in one pass over openers left open', () => {
  const pieces = ['<style>', '<style a="b">', '<STYLE', '</style>', '</style >', '</Style\n>', '<!--', '-->', '->', '<b>', 'x', '<styles>'];
  let state = 7;
  const pick = () => pieces[(state = (state * 1103515245 + 12345) & 0x7fffffff) % pieces.length]!;
  for (let n = 0; n < 2000; n++) {
    const html = Array.from({ length: n % 13 }, pick).join('');
    expect(withoutStyles(html)).toBe(html.replace(/<style\b[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, ''));
  }
  const open = '<style<!--'.repeat(100_000);
  expect(withoutStyles(open)).toBe(open);
});

it('reads a null insertion order as 0, where Risu sorts it, and a missing one as a new entry’s', () => {
  expect(chatLorebook([{ key: 'a', insertorder: null }, { key: 'b' }]).lore.map(({ insertionOrder }) => insertionOrder)).toEqual([0, DEFAULT_ORDER]);
  expect(bookLorebook([{ keys: ['a'], insertion_order: null }]).lore.map(({ insertionOrder }) => insertionOrder)).toEqual([0]);
});
