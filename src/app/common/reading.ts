import { PICTURE_PERCENT, type Backdrop } from '../../model/library';
import type { SavedLook } from '../../model/settings';
import { ACCENT, applyScheme, BG, DIALOGUE, FONTS, INK, QUOTE_SHAPE, SHADE, THEME, type QuoteShape, type Reading, type Scheme, type StageSide, type Theme } from '../ui';
import type { Cue } from '../../runtime/chat/cues';
import { CHIMES, type Chime } from './sounds';
import { readPersisted } from './usePersisted';

// Per device, never in the synced settings, since a phone and a desktop screen differ (user, 2026-09-29).
export const READING = 'risu-alpha:reading';
export const DISPLAY = 'risu-alpha:display';

export const SIZE = { min: 14, max: 21 };

export const SPACING: Record<Reading['leading'], string> = { narrow: '좁게', normal: '보통', wide: '넓게', widest: '매우 넓게' };
export const REPLY: Record<Reading['reply'], string> = { follow: '자동 스크롤', stay: '스크롤 고정' };
export const SIDE: Record<StageSide, string> = { right: '오른쪽', left: '왼쪽' };

export const choices = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const named = <T extends string>(labels: Record<T, unknown>, value: unknown) => (typeof value === 'string' && Object.hasOwn(labels, value) ? (value as T) : undefined);
const known = <T extends string>(labels: Record<T, unknown>, value: unknown, otherwise: T) => named(labels, value) ?? otherwise;
const sized = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= SIZE.min && value <= SIZE.max ? value : undefined);
const percent = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= PICTURE_PERCENT.min && value <= PICTURE_PERCENT.max ? value : undefined);
const flag = (value: unknown, otherwise: boolean) => (typeof value === 'boolean' ? value : otherwise);

function fields<K extends string>(stored: string): Partial<Record<K, unknown>> {
  const parsed: unknown = JSON.parse(stored);
  return typeof parsed === 'object' && parsed !== null ? parsed : {};
}

// Stored on the device, so another version or a hand may have written it: a field that is not one of the choices
// starts from fallback's.
export function parseReading(stored: string, fallback: Reading): Reading {
  const read = fields<keyof Reading>(stored);
  return {
    font: known(FONTS, read.font, fallback.font),
    size: sized(read.size) ?? fallback.size,
    leading: known(SPACING, read.leading, fallback.leading),
    width: known(SPACING, read.width, fallback.width),
    reply: known(REPLY, read.reply, fallback.reply),
  };
}

// Reading chrome (quotes/pictureSide/inlineIllustrations/portrait) never comes from presets.
// Portrait stage is reserved for chats without illustration (user, 2026-10-16); width cap preserves old default (2026-10-17).
// Track last system mode so reload preserves manual edits until the next mode change (user, 2026-10-20).
// Chimes default off and use chimeSounds once enabled (user, 2026-10-26).
export type Display = Scheme & { chimes: boolean; chimeSounds: Record<Cue, Chime>; follow: Follow | null; quotes: QuoteShape; hideHeader: boolean; foldComposer: boolean; enterSendsChoice: boolean | null; hidePictures: boolean; pictureWidest: number; wideFill: boolean; pictureSide: StageSide; inlineIllustrations: boolean; portrait: boolean; stepButtons: boolean; scrubber: boolean; userStops: boolean };

export type Follow = Record<Theme, string> & { applied: Theme };

const PLAIN = { bg: 'base', ink: 'base', accent: 'base', dialogue: 'base' } as const;

export const DISPLAY_DEFAULT: Display = { chimes: false, chimeSounds: { 'reply-started': 'off', 'reply-received': 'ding', translated: 'dingdong' }, theme: 'dark', ...PLAIN, follow: null, quotes: 'color', hideHeader: false, foldComposer: true, enterSendsChoice: null, hidePictures: false, pictureWidest: 100, wideFill: true, pictureSide: 'right', inlineIllustrations: false, portrait: false, stepButtons: false, scrubber: true, userStops: false };

export function parseDisplay(stored: string, fallback: Display): Display {
  const read = fields<keyof Display | 'enterSends'>(stored);
  return {
    chimes: flag(read.chimes, fallback.chimes),
    chimeSounds: parseChimeSounds(read.chimeSounds, fallback.chimeSounds),
    theme: known(THEME, read.theme, fallback.theme),
    bg: known(BG, read.bg, fallback.bg),
    ink: known(INK, read.ink, fallback.ink),
    accent: known(ACCENT, read.accent, fallback.accent),
    dialogue: known(DIALOGUE, read.dialogue, fallback.dialogue),
    follow: read.follow === undefined ? fallback.follow : parseFollow(read.follow),
    quotes: known(QUOTE_SHAPE, read.quotes, fallback.quotes),
    hideHeader: flag(read.hideHeader, fallback.hideHeader),
    foldComposer: flag(read.foldComposer, fallback.foldComposer),
    // The old enterSends was saved whole with every display change, so its true says nobody chose it; only false was picked.
    enterSendsChoice: typeof read.enterSendsChoice === 'boolean' ? read.enterSendsChoice : read.enterSends === false ? false : fallback.enterSendsChoice,
    hidePictures: flag(read.hidePictures, fallback.hidePictures),
    pictureWidest: percent(read.pictureWidest) ?? fallback.pictureWidest,
    wideFill: flag(read.wideFill, fallback.wideFill),
    pictureSide: known(SIDE, read.pictureSide, fallback.pictureSide),
    inlineIllustrations: flag(read.inlineIllustrations, fallback.inlineIllustrations),
    portrait: flag(read.portrait, fallback.portrait),
    stepButtons: flag(read.stepButtons, fallback.stepButtons),
    scrubber: flag(read.scrubber, fallback.scrubber),
    userStops: flag(read.userStops, fallback.userStops),
  };
}

function parseChimeSounds(value: unknown, fallback: Display['chimeSounds']): Display['chimeSounds'] {
  const read = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<Cue, unknown>>;
  return { 'reply-started': known(CHIMES, read['reply-started'], fallback['reply-started']), 'reply-received': known(CHIMES, read['reply-received'], fallback['reply-received']), translated: known(CHIMES, read.translated, fallback.translated) };
}

// An id no preset has any more is kept: it is shown as missing where it is picked, and applies nothing.
function parseFollow(value: unknown): Follow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { light, dark, applied } = value as Partial<Record<keyof Follow, unknown>>;
  const mode = named(THEME, applied);
  return typeof light === 'string' && typeof dark === 'string' && mode ? { light, dark, applied: mode } : null;
}

// Coarse with no choice is deliberately false: Enter breaks the line there, and the send button sends.
export const effectiveEnterSends = (choice: Display['enterSendsChoice'], coarsePointer: boolean) => choice ?? !coarsePointer;

export const parseStoredDisplay = (stored: string) => parseDisplay(stored, DISPLAY_DEFAULT);

export const systemMode = (dark: boolean): Theme => (dark ? 'dark' : 'light');

// Apply before first paint without display.tsx's session dependency. Every preset is the account's, so a system-mode
// switch while closed keeps the last look until that account loads.
export const applyStoredScheme = () => applyScheme(readPersisted(DISPLAY, parseStoredDisplay, DISPLAY_DEFAULT));

// A preset sets the look only, never 응답이 올 때 or the reading chrome. No preset id is stored: the current preset is
// the one whose every value matches.
export type Look = Pick<Reading, 'font' | 'size' | 'leading' | 'width'> & Scheme;
// id: what a 시스템 따라 바꾸기 slot and a character's look hold, its saved id.
export type Preset = { id: string; name: string; look: Look };

export const lookOf = ({ font, size, leading, width }: Reading, { theme, bg, ink, accent, dialogue }: Display): Look => ({ theme, bg, ink, accent, dialogue, font, size, leading, width });

const LOOK: Record<keyof Look, true> = { theme: true, bg: true, ink: true, accent: true, dialogue: true, font: true, size: true, leading: true, width: true };
const LOOK_KEYS = Object.keys(LOOK) as (keyof Look)[];

export function presetOf(list: Preset[], reading: Reading, display: Display): Preset | undefined {
  const now = lookOf(reading, display);
  return list.find(({ look }) => LOOK_KEYS.every((key) => look[key] === now[key]));
}

// Unknown newer-version values count as unread; never substitute a look the preset did not save.
export function savedPresets(looks: SavedLook[] = []): { presets: Preset[]; unread: number } {
  const presets = looks.flatMap(({ id, name, look }) => {
    const read = parseLook(look);
    return read && typeof id === 'string' ? [{ id, name, look: read }] : [];
  });
  return { presets, unread: looks.length - presets.length };
}

function parseLook(look: SavedLook['look']): Look | null {
  const read = {
    theme: named(THEME, look.theme),
    bg: named(BG, look.bg),
    ink: named(INK, look.ink),
    accent: named(ACCENT, look.accent),
    // Looks saved by v0.1.73 predate 대사.
    dialogue: look.dialogue === undefined ? 'base' : named(DIALOGUE, look.dialogue),
    font: named(FONTS, look.font),
    size: sized(look.size),
    leading: named(SPACING, look.leading),
    width: named(SPACING, look.width),
  };
  return LOOK_KEYS.every((key) => read[key] !== undefined) ? (read as Look) : null;
}

// A character's 배경 가림 and 배경 흐림 (design §6.4), by name; unset, or a name this version does not know, is the look
// backgrounds had before: Risu's veil, unblurred.
export const backdropShades = (backdrop: Backdrop | undefined) => ({ veil: known(SHADE, backdrop?.veil, 'high'), blur: known(SHADE, backdrop?.blur, 'none') });

// What a character's chats wear (design §6.4): its preset's colors and 글꼴 over the device's look, its size and spacing
// left the device's; the device's own, with no scheme of its own, for no preset or for one that is gone.
export const wornLook = (preset: Preset | undefined, reading: Reading, theme: Theme) =>
  preset ? { scheme: preset.look, theme: preset.look.theme, reading: { ...reading, font: preset.look.font } } : { scheme: undefined, theme, reading };
