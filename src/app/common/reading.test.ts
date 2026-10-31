import { describe, expect, it } from 'vitest';
import type { Reading } from '../ui';
import { DISPLAY_DEFAULT, effectiveEnterSends, lookOf, moveLook, parseDisplay, parseReading, presetOf, presets, savedPresets } from './reading';

const FALLBACK: Reading = { font: 'serif', size: 17, leading: 'normal', width: 'normal', reply: 'follow' };

describe('stored reading settings', () => {
  it('keeps the known choices and starts each unknown or out-of-range field from the fallback', () => {
    const chosen: Reading = { font: 'nanum-pen', size: 21, leading: 'widest', width: 'widest', reply: 'stay' };
    expect(parseReading(JSON.stringify(chosen), FALLBACK)).toEqual(chosen);
    expect(parseReading(JSON.stringify({ font: 'mono', size: 22, leading: 'wide' }), FALLBACK)).toEqual({ ...FALLBACK, leading: 'wide' });
    expect(parseReading('null', FALLBACK)).toEqual(FALLBACK);
  });

  it('reads reading settings stored before 응답이 올 때 as following the reply', () => {
    expect(parseReading(JSON.stringify({ font: 'sans', size: 17, leading: 'normal', width: 'normal' }), FALLBACK).reply).toBe('follow');
    expect(parseReading(JSON.stringify({ ...FALLBACK, reply: 'jump' }), FALLBACK).reply).toBe('follow');
  });
});

describe('stored display settings', () => {
  it('keeps a known theme, color picks and real switches, and starts anything else from the fallback', () => {
    const chosen = { chimes: true, chimeSounds: { 'reply-started': 'tap', 'reply-received': 'off', translated: 'ding' }, theme: 'light', bg: 'blue', ink: 'soft', accent: 'rose', dialogue: 'plain', follow: { light: 'deleted-own', dark: 'sea', applied: 'dark' }, quotes: 'box', hideHeader: false, foldComposer: true, enterSendsChoice: false, hidePictures: true, pictureWidest: 60, wideFill: false, pictureSide: 'left', inlineIllustrations: true, portrait: true, stepButtons: true, scrubber: false, userStops: true, cacheNote: false } as const;
    expect(parseDisplay(JSON.stringify(chosen), DISPLAY_DEFAULT)).toEqual(chosen);
    expect(parseDisplay(JSON.stringify({ chimes: 'yes', chimeSounds: { 'reply-started': 'bell', translated: 3 }, theme: 'sepia', bg: 'teal', accent: 3, quotes: 'bubble', follow: { light: 'study', dark: 3, applied: 'dark' }, hideHeader: 'no', enterSendsChoice: 0, enterSends: 0, hidePictures: 1, pictureWidest: 5, wideFill: 'no', pictureSide: 'top', inlineIllustrations: 'yes', portrait: 'yes' }), DISPLAY_DEFAULT)).toEqual(DISPLAY_DEFAULT);
  });
});

describe('Enter로 보내기', () => {
  const choice = (stored: object) => parseDisplay(JSON.stringify(stored), DISPLAY_DEFAULT).enterSendsChoice;

  it('carries the old false over as a choice and reads the old true, which nobody had to pick, as none', () => {
    expect(choice({ enterSends: false })).toBe(false);
    expect(choice({ enterSends: true })).toBeNull();
    expect(choice({})).toBeNull();
  });

  it('keeps a choice stored in the new field, and drops the old field from what is saved next', () => {
    expect(choice({ enterSendsChoice: true })).toBe(true);
    expect(choice({ enterSendsChoice: false })).toBe(false);
    expect(parseDisplay(JSON.stringify({ enterSends: false }), DISPLAY_DEFAULT)).not.toHaveProperty('enterSends');
  });

  it('follows the pointer until a choice overrides it', () => {
    expect(effectiveEnterSends(null, false)).toBe(true);
    expect(effectiveEnterSends(null, true)).toBe(false);
    expect(effectiveEnterSends(true, true)).toBe(true);
    expect(effectiveEnterSends(false, false)).toBe(false);
  });
});

describe('the current preset', () => {
  it('is the one whose every look value matches, whatever 응답이 올 때 and the chrome switches say', () => {
    const list = presets(FALLBACK);
    expect(presetOf(list, { ...FALLBACK, reply: 'stay' }, { ...DISPLAY_DEFAULT, hideHeader: false })?.name).toBe('기본');
    expect(presetOf(list, FALLBACK, { ...DISPLAY_DEFAULT, theme: 'light' })?.name).toBe('밝은 서재');
    expect(presetOf(list, { ...FALLBACK, size: 16 }, DISPLAY_DEFAULT)).toBeUndefined();
    expect(presetOf(list, FALLBACK, { ...DISPLAY_DEFAULT, accent: 'blue' })).toBeUndefined();
  });
});

describe('saved presets', () => {
  it('reads each saved look, and counts one with a value this version does not know instead of showing it', () => {
    const look = lookOf(FALLBACK, { ...DISPLAY_DEFAULT, bg: 'green', accent: 'violet' });
    const read = savedPresets([
      { id: 'a', name: '숲', look },
      { id: 'b', name: '다음 버전', look: { ...look, bg: 'aurora' } },
    ]);
    expect(read).toEqual({ presets: [{ id: 'a', name: '숲', look }], unread: 1 });
    expect(presetOf(read.presets, FALLBACK, { ...DISPLAY_DEFAULT, bg: 'green', accent: 'violet' })?.name).toBe('숲');
  });

  it('reads a look saved before 대사 as the base dialogue', () => {
    const look = lookOf(FALLBACK, { ...DISPLAY_DEFAULT, bg: 'blue' });
    const before: Record<string, string | number> = { ...look };
    delete before.dialogue;
    expect(savedPresets([{ id: 'a', name: '밤', look: before }]).presets[0]?.look).toEqual(look);
  });
});

describe('moving a saved preset', () => {
  it('lands it where the target was, either way, and keeps an unread one among the rest', () => {
    const look = lookOf(FALLBACK, DISPLAY_DEFAULT);
    const looks = ['a', 'b', 'x', 'c'].map((id) => ({ id, name: id, look }));
    expect(moveLook(looks, 'a', 'c').map(({ id }) => id)).toEqual(['b', 'x', 'c', 'a']);
    expect(moveLook(looks, 'c', 'b').map(({ id }) => id)).toEqual(['a', 'c', 'b', 'x']);
  });
});
