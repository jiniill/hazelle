import { PICTURE_PERCENT, type Backdrop } from '../../model/library';
import type { SavedLook } from '../../model/settings';
import { ACCENT, applyScheme, BG, DIALOGUE, FONTS, INK, QUOTE_SHAPE, MODE, SHADE, THEMES, type Letters, type Mode, type QuoteShape, type Reading, type Scheme, type StageSide, type Theme, type ThemeId } from '../ui';
import type { Cue } from '../../runtime/chat/cues';
import { CHIMES, type Chime } from './sounds';
import { readPersisted } from './usePersisted';

// Per device, never in the synced settings, since a phone and a desktop screen differ (user, 2026-09-29).
export const READING = 'risu-alpha:reading';
// Where a theme that states letters keeps the reader's changes to them: one record per theme, beside READING, which
// stays the record of the themes that state none (user, 2026-11-13).
export const lettersKey = (theme: Theme) => `${READING}:${theme.id}`;
export const DISPLAY = 'risu-alpha:display';

export const SIZE = { min: 14, max: 21 };

export const SPACING: Record<Reading['leading'], string> = { narrow: '좁게', normal: '보통', wide: '넓게', widest: '더 넓게' };
export const WIDTH: Record<Reading['width'], string> = { ...SPACING, full: '가득' };
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
export function parseLetters(stored: string, fallback: Letters): Letters {
  const read = fields<keyof Letters>(stored);
  return {
    font: known(FONTS, read.font, fallback.font),
    size: sized(read.size) ?? fallback.size,
    leading: known(SPACING, read.leading, fallback.leading),
    width: known(WIDTH, read.width, fallback.width),
  };
}

export const parseReading = (stored: string, fallback: Reading): Reading => ({ ...parseLetters(stored, fallback), reply: known(REPLY, fields<keyof Reading>(stored).reply, fallback.reply) });

export const lettersOf = ({ font, size, leading, width }: Letters): Letters => ({ font, size, leading, width });

// Reading chrome (quotes/pictureSide/inlineIllustrations/portrait) never comes from presets.
// Portrait stage is reserved for chats without illustration (user, 2026-10-16); width cap preserves old default (2026-10-17).
// Track last system mode so reload preserves manual edits until the next mode change (user, 2026-10-20).
// Chimes default off and use chimeSounds once enabled (user, 2026-10-26).
export type Display = Scheme & { theme: ThemeId; chimes: boolean; chimeSounds: Record<Cue, Chime>; follow: Follow | null; quotes: QuoteShape; hideHeader: boolean; foldComposer: boolean; enterSendsChoice: boolean | null; hidePictures: boolean; pictureWidest: number; wideFill: boolean; pictureSide: StageSide; inlineIllustrations: boolean; portrait: boolean; stepButtons: boolean; scrubber: boolean; toolsFollow: boolean; splitReplies: boolean; userStops: boolean; modes: Partial<Record<ThemeId, Mode>> };

export type Follow = Record<Mode, string> & { applied: Mode };

const PLAIN = { bg: 'base', ink: 'base', accent: 'base', dialogue: 'base' } as const;

export const DISPLAY_DEFAULT: Display = { theme: 'base', chimes: false, chimeSounds: { 'reply-started': 'off', 'reply-received': 'ding', translated: 'dingdong' }, mode: 'dark', ...PLAIN, follow: null, quotes: 'color', hideHeader: false, foldComposer: true, enterSendsChoice: null, hidePictures: false, pictureWidest: 100, wideFill: true, pictureSide: 'right', inlineIllustrations: false, portrait: false, stepButtons: false, scrubber: true, toolsFollow: true, splitReplies: true, userStops: false, modes: {} };

export function parseDisplay(stored: string, fallback: Display): Display {
  const read = fields<keyof Display | 'enterSends'>(stored);
  return {
    // 디스코드 was offered as channel (v0.6.34, by 설정 › 테마's address) before the themes took the products' names.
    theme: known(THEMES, read.theme === 'channel' ? 'discord' : read.theme, fallback.theme),
    chimes: flag(read.chimes, fallback.chimes),
    chimeSounds: parseChimeSounds(read.chimeSounds, fallback.chimeSounds),
    // The key theme held the mode until 2026-11-13, when theme came to mean the app's whole look. A display saved
    // before has no mode, so its theme is read as one; no theme takes a mode's name.
    mode: known(MODE, read.mode ?? read.theme, fallback.mode),
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
    toolsFollow: flag(read.toolsFollow, fallback.toolsFollow),
    splitReplies: flag(read.splitReplies, fallback.splitReplies),
    userStops: flag(read.userStops, fallback.userStops),
    modes: parseModes(read.modes),
  };
}

function parseModes(value: unknown): Display['modes'] {
  const read = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  return Object.fromEntries((Object.keys(THEMES) as ThemeId[]).flatMap((id) => (named(MODE, read[id]) ? [[id, read[id]]] : [])));
}

// The mode a theme is worn in: the worn one's is the display's, another's the one it was left in, else the one it
// states, else the reader's now. A display saved before modes has none left, so its worn theme keeps its mode.
export const modeIn = ({ theme, mode, modes }: Display, id: ThemeId): Mode => (id === theme ? mode : (modes[id] ?? THEMES[id].mode ?? mode));

// Changing the theme leaves the mode with the one taken off and takes the next one's.
export const wearing = (display: Display, theme: ThemeId): Pick<Display, 'theme' | 'mode' | 'modes'> => ({ theme, mode: modeIn(display, theme), modes: { ...display.modes, [display.theme]: display.mode } });

function parseChimeSounds(value: unknown, fallback: Display['chimeSounds']): Display['chimeSounds'] {
  const read = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<Cue, unknown>>;
  return { 'reply-started': known(CHIMES, read['reply-started'], fallback['reply-started']), 'reply-received': known(CHIMES, read['reply-received'], fallback['reply-received']), translated: known(CHIMES, read.translated, fallback.translated) };
}

// An id no preset has any more is kept: it is shown as missing where it is picked, and applies nothing.
function parseFollow(value: unknown): Follow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { light, dark, applied } = value as Partial<Record<keyof Follow, unknown>>;
  const mode = named(MODE, applied);
  return typeof light === 'string' && typeof dark === 'string' && mode ? { light, dark, applied: mode } : null;
}

// Coarse with no choice is deliberately false: Enter breaks the line there, and the send button sends.
export const effectiveEnterSends = (choice: Display['enterSendsChoice'], coarsePointer: boolean) => choice ?? !coarsePointer;

export const parseStoredDisplay = (stored: string) => parseDisplay(stored, DISPLAY_DEFAULT);

export const systemMode = (dark: boolean): Mode => (dark ? 'dark' : 'light');

// Apply before first paint without display.tsx's session dependency. Every preset is the account's, so a system-mode
// switch while closed keeps the last look until that account loads.
export function applyStoredScheme() {
  const display = readPersisted(DISPLAY, parseStoredDisplay, DISPLAY_DEFAULT);
  applyScheme(display, THEMES[display.theme]);
}

// A preset sets the look only, never 응답이 올 때 or the reading chrome. No preset id is stored: the current preset is
// the one whose every value matches.
export type Look = Letters & Scheme;
// id: what a 시스템 따라 바꾸기 slot and a character's look hold, its saved id.
export type Preset = { id: string; name: string; look: Look };


export const lookOf = (letters: Letters, { mode, bg, ink, accent, dialogue }: Display): Look => ({ mode, bg, ink, accent, dialogue, ...lettersOf(letters) });

// 초기화's: a theme's first letters with no colour picked, in the mode the theme states; 기본 states none and takes the default's.
export const firstLook = (letters: Letters, theme: ThemeId): Look => lookOf(letters, { ...DISPLAY_DEFAULT, mode: THEMES[theme].mode ?? DISPLAY_DEFAULT.mode });

const LOOK: Record<keyof Look, true> = { mode: true, bg: true, ink: true, accent: true, dialogue: true, font: true, size: true, leading: true, width: true };
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
    mode: named(MODE, look.mode),
    bg: named(BG, look.bg),
    ink: named(INK, look.ink),
    accent: named(ACCENT, look.accent),
    // Looks saved by v0.1.73 predate 대사.
    dialogue: look.dialogue === undefined ? 'base' : named(DIALOGUE, look.dialogue),
    font: named(FONTS, look.font),
    size: sized(look.size),
    leading: named(SPACING, look.leading),
    width: named(WIDTH, look.width),
  };
  return LOOK_KEYS.every((key) => read[key] !== undefined) ? (read as Look) : null;
}

// A character's 배경 가림 and 배경 흐림 (design §6.4), by name; unset, or a name this version does not know, is the look
// backgrounds had before: Risu's veil, unblurred.
export const backdropShades = (backdrop: Backdrop | undefined) => ({ veil: known(SHADE, backdrop?.veil, 'high'), blur: known(SHADE, backdrop?.blur, 'none') });

// What a character's chats wear (design §6.4): its preset's colors and 글꼴 over the device's look, its size and spacing
// left the device's; the device's own, with no scheme of its own, for no preset or for one that is gone.
export const wornLook = (preset: Preset | undefined, reading: Reading, mode: Mode) =>
  preset ? { scheme: preset.look, mode: preset.look.mode, reading: { ...reading, font: preset.look.font } } : { scheme: undefined, mode, reading };
