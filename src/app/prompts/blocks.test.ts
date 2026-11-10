import { describe, expect, it } from 'vitest';
import type { Block } from '../../model/prompt';
import { blockHit, blockMeta, cacheMarks } from './blocks';

const text = (id: string, cache?: true): Block => ({ id, name: null, kind: 'text', role: 'system', text: id, mark: null, ...(cache && { cache }) });
const chat = (id: string): Block => ({ id, name: null, kind: 'slot', slot: 'chat', range: { from: 0, to: null } });

describe('cacheMarks', () => {
  it('draws the engine’s two points before the first chat block and after the last, and a block’s own over them', () => {
    const marks = cacheMarks([text('rules', true), text('premise'), chat('past'), chat('last'), text('note')]);
    expect(Object.fromEntries(marks)).toEqual({ rules: 'set', premise: 'auto', last: 'auto' });
    expect(Object.fromEntries(cacheMarks([chat('only'), text('note', true)]))).toEqual({ only: 'auto', note: 'set' });
  });
});

describe('blockMeta', () => {
  it('says a role only when it is not 시스템', () => {
    expect(blockMeta(text('rules'))).toBe('5자');
    expect(blockMeta({ ...text('rules'), role: 'user' } as Block)).toBe('사용자 · 5자');
    expect(blockMeta({ id: 'p', name: null, kind: 'slot', slot: 'persona', role: 'system', wrapper: null })).toBe('');
    expect(blockMeta({ id: 'p', name: null, kind: 'slot', slot: 'persona', role: 'assistant', wrapper: null })).toBe('AI');
  });
});

describe('blockHit', () => {
  const named = (name: string, value: string): Block => ({ id: 'a', kind: 'text', name, role: 'system', text: value, mark: null });

  it('lights the name where it holds the words, after the block\'s place in the order', () => {
    expect(blockHit(named('Guide Lines', 'body'), 11, 'LINE')).toEqual({ name: { text: '12. Guide Lines', from: 10, to: 14 }, snippet: null, first: null, count: 0 });
  });

  it('counts the places in the text, selects the first and shows the words around it on one line', () => {
    const hit = blockHit(named('Rules', `${'x'.repeat(40)}\nYou are {{char}}.\nNever {{CHAR}}.`), 0, 'char');
    expect(hit.count).toBe(2);
    expect(hit.first).toEqual([51, 55]);
    expect(hit.snippet).toEqual({ text: `…${'x'.repeat(13)} You are {{char}}. Never {{CHAR}}.`, from: 25, to: 29 });
    expect(hit.name).toBe('1. Rules');
  });
});
