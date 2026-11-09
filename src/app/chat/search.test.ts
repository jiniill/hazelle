import { describe, expect, it } from 'vitest';
import type { Version } from '../../model/chat';
import { finder, seenText } from './search';

describe('finder', () => {
  it('finds the term in what the reader sees, in chat order', () => {
    const find = finder();
    const texts = ['<p class="Hello">nothing</p>', 'Say <b>HEL</b>LO there', 'a < b > hello', '한 안녕', 'hello'];
    expect(find(texts, ' Hello ')).toEqual([1, 2, 4]);
    expect(find(texts, '한')).toEqual([3]);
    expect(find(texts, 'class')).toEqual([]);
    expect(find(texts, '  ')).toEqual([]);
  });
});

it('reads a version as its translation, the translation streaming in, or the original once flipped', () => {
  const version = { translation: { text: '번역' } } as Version;
  const plain = (text: string) => text;
  expect(seenText('원문', version, null, false, plain)).toBe('번역');
  expect(seenText('원문', version, '번역 중', false, plain)).toBe('번역 중');
  expect(seenText('원문', version, '번역 중', true, plain)).toBe('원문');
  expect(seenText('원문', {} as Version, null, false, plain)).toBe('원문');
});

it('shows a translation, stored or streaming, through the translation scripts, and the original without them', () => {
  const version = { translation: { text: '번역' } } as Version;
  const edited = (text: string) => `[${text}]`;
  expect(seenText('원문', version, null, false, edited)).toBe('[번역]');
  expect(seenText('원문', version, '번역 중', false, edited)).toBe('[번역 중]');
  expect(seenText('원문', version, null, true, edited)).toBe('원문');
  expect(seenText('원문', {} as Version, '', false, edited)).toBe('원문');
});
