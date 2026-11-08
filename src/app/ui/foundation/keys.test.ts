import { describe, expect, it } from 'vitest';
import { formatKeys, keyCaps, pressed, pressedKey, type Chord } from './keys';

const press = (key: string | undefined, { shift = false, ctrl = false, meta = false, alt = false, composing = false, keyCode = 0, code = '' } = {}) => ({
  key,
  code,
  shiftKey: shift,
  ctrlKey: ctrl,
  metaKey: meta,
  altKey: alt,
  nativeEvent: { isComposing: composing, keyCode },
});

const enter: Chord[] = [{ key: 'Enter', shift: false }];
const modEnter: Chord[] = [{ key: 'Enter', mod: true }];
const escape: Chord[] = [{ key: 'Escape' }];
const arrows: Chord[] = [{ key: 'ArrowLeft' }, { key: 'ArrowRight' }];

describe('keys', () => {
  it('tells Alt held apart, whether or not a chord names it', () => {
    expect(pressed(press('ArrowLeft', { alt: true }), arrows)).toBe(false);
    expect(pressed(press('ArrowUp', { alt: true }), [{ key: 'ArrowUp', alt: true }])).toBe(true);
  });

  it('checks only the modifiers a chord names', () => {
    expect(pressed(press('Enter'), enter)).toBe(true);
    expect(pressed(press('Enter', { ctrl: true }), enter)).toBe(true);
    expect(pressed(press('Enter', { shift: true }), enter)).toBe(false);
    expect(pressed(press('Enter'), modEnter)).toBe(false);
    expect(pressed(press('Enter', { meta: true }), modEnter)).toBe(true);
    expect(pressed(press('Enter', { ctrl: true, shift: true }), modEnter)).toBe(true);
    expect(pressedKey(press('ArrowLeft', { shift: true }), arrows)).toBe(0);
    expect(pressedKey(press('ArrowRight'), arrows)).toBe(1);
    expect(pressedKey(press('ArrowUp'), arrows)).toBe(-1);
  });

  it('passes over a keydown with no key, as Chrome sends on autofill', () => {
    expect(pressed(press(undefined, { ctrl: true }), [{ key: 'z', mod: true }, { key: 'Enter' }])).toBe(false);
  });

  it('matches a letter chord by the letter or the key it sits on', () => {
    const redo: Chord[] = [{ key: 'z', mod: true, shift: true }];
    expect(pressed(press('Z', { ctrl: true, shift: true, code: 'KeyZ' }), redo)).toBe(true);
    expect(pressed(press('ㅋ', { ctrl: true, shift: true, code: 'KeyZ' }), redo)).toBe(true);
    expect(pressed(press('z', { ctrl: true, shift: true, code: 'KeyY' }), redo)).toBe(true);
    expect(pressed(press('y', { ctrl: true, shift: true, code: 'KeyY' }), redo)).toBe(false);
  });

  it('takes no key while a syllable is being composed', () => {
    expect(pressed(press('Enter', { composing: true }), enter)).toBe(false);
    expect(pressed(press('Enter', { keyCode: 229 }), enter)).toBe(false);
    expect(pressed(press('Enter', { ctrl: true, composing: true }), modEnter)).toBe(false);
    expect(pressed(press('Escape', { composing: true }), escape)).toBe(false);
  });

  it('writes chords as key caps and as text', () => {
    expect(keyCaps({ key: 'Enter', shift: true })).toEqual(['Shift', 'Enter']);
    expect(keyCaps({ key: 'Enter', mod: true })).toEqual(['Ctrl', 'Enter']);
    expect(keyCaps({ key: 'Enter', shift: false })).toEqual(['Enter']);
    expect(arrows.flatMap(keyCaps)).toEqual(['←', '→']);
    expect(formatKeys(modEnter)).toBe('Ctrl+Enter');
    expect(formatKeys(arrows)).toBe('← →');
    expect(formatKeys([{ key: 'e', mod: true }])).toBe('Ctrl+E');
  });
});
