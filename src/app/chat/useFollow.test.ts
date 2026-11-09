import { describe, expect, it } from 'vitest';
import { anchorOf, atEnd, followPill } from './useFollow';

describe('the view at the story end', () => {
  it('stays at the end until well above it, and comes back only at the very end', () => {
    expect(atEnd(0, false)).toBe(true);
    expect(atEnd(10, false)).toBe(false);
    expect(atEnd(10, true)).toBe(true);
    expect(atEnd(48, true)).toBe(false);
  });
});

describe('the message a staying view puts at the top', () => {
  it('is the user\'s message a reply answers, and the reply itself after the model\'s own message', () => {
    const messages = [{ id: 'g', role: 'assistant' }, { id: 'u', role: 'user' }, { id: 'a', role: 'assistant' }, { id: 'b', role: 'assistant' }];
    expect(anchorOf(messages, 'a')).toBe('u');
    expect(anchorOf(messages, 'b')).toBe('b');
    expect(anchorOf(messages, 'c')).toBe(null);
  });
});

describe('the pill that follows the story down', () => {
  it('says where it goes while a reply is written, and 새 응답 once one landed unread', () => {
    expect(followPill(false, true, true)).toBe(null);
    expect(followPill(true, true, true)).toBe('맨 아래로');
    expect(followPill(true, false, true)).toBe('새 응답');
    expect(followPill(true, false, false)).toBe('맨 아래로');
  });
});
