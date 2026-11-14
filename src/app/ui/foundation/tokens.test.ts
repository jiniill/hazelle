import { expect, it } from 'vitest';
import { THEMES } from '../themes';
import { schemeAttributes, type Mode, type Scheme } from './scheme';
import { BASE, themeRules, type Theme, type Tone } from './theme';
import tokens from './tokens.css?raw';

const palette = new Map([...tokens.matchAll(/--(palette-[\w-]+): (#[\da-f]{6});/g)].map((match) => [match[1]!, match[2]!]));
const [, dark, light] = /\n\[data-mode='dark'\] \{([\s\S]*?)\n\}[\s\S]*?\n\[data-mode='light'\] \{([\s\S]*?)\n\}/.exec(tokens)!;

function color(mode: string, role: string): string {
  const name = new RegExp(`--color-${role}: var\\(--(palette-[\\w-]+)\\);`).exec(mode)![1]!;
  return palette.get(name)!;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const lightness = (hex: string) => 116 * Math.cbrt(luminance(hex)) - 16;

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const FILLS = ['bg', 'sidebar', 'surface', 'surface-hover'];

it.each([['dark', dark!], ['light', light!]])('keeps %s faint text at AA on every row fill but the current one, a rung from muted', (_, mode) => {
  const faint = color(mode, 'text-faint');
  for (const fill of FILLS) expect(contrast(faint, color(mode, fill))).toBeGreaterThanOrEqual(4.5);
  expect(Math.abs(lightness(faint) - lightness(color(mode, 'text-muted')))).toBeGreaterThanOrEqual(4);
});

// A theme's colours are not palette names, so its rungs are worked out here as tokens.css mixes them.
function linear(hex: string): number[] {
  return [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
}

function oklab(hex: string): number[] {
  const [r, g, b] = linear(hex) as [number, number, number];
  const [l, m, s] = [0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b, 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b, 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b].map(Math.cbrt) as [number, number, number];
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function hexOf([L, a, b]: number[]): string {
  const [l, m, s] = [L! + 0.3963377774 * a! + 0.2158037573 * b!, L! - 0.1055613458 * a! - 0.0638541728 * b!, L! - 0.0894841775 * a! - 1.291485548 * b!].map((root) => root ** 3) as [number, number, number];
  const channels = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${channels.map((channel) => Math.round(255 * (channel <= 0.0031308 ? 12.92 * Math.max(0, channel) : 1.055 * Math.min(1, channel) ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0')).join('')}`;
}

// What a pick's rule gives a seed: a share of white or black over it, mixed in oklab.
function mixed(mode: Mode, pick: 'bg' | 'accent', role: string, seed: string): string {
  const rules = new RegExp(`\\[data-mode='${mode}'\\]:is\\(\\[data-${pick}\\][^{]*\\{([\\s\\S]*?)\\n\\}`).exec(tokens)![1]!;
  const [, tint, share] = new RegExp(`--color-${role}: color-mix\\(in oklab, var\\(--palette-(white|black)\\) ([\\d.]+)%, var\\(--color-pick-${pick}\\)\\);`).exec(rules)!;
  const [over, under] = [oklab(tint === 'white' ? '#ffffff' : '#000000'), oklab(seed)];
  return hexOf(over.map((value, at) => (Number(share) / 100) * value + (1 - Number(share) / 100) * under[at]!));
}

const rung = (mode: Mode, role: string, page: string) => mixed(mode, 'bg', role, page);

// The fills words stand on, as the theme states them or as the rule gives them to its page.
const fillsOf = (mode: Mode, tone: Tone) => [tone.page, tone.sidebar ?? rung(mode, 'sidebar', tone.page), tone.surface ?? rung(mode, 'surface', tone.page), tone.hover ?? rung(mode, 'surface-hover', tone.page)];

const WORN: Scheme = { mode: 'dark', bg: 'base', ink: 'base', accent: 'base', dialogue: 'base' };
// Every set of colours a theme states: its own per mode, and a part's in the mode the part takes, whose sidebar is
// its page.
const themed = Object.values<Theme>(THEMES).flatMap((theme) => [
  ...(theme.tones ? (Object.entries(theme.tones) as [Mode, Tone][]).map((tone) => [theme.id, ...tone, theme] as const) : []),
  ...(['side', 'room'] as const).flatMap((part) => Object.values(theme[part] ?? {}).map(({ mode, tone }) => [`${theme.id}'s ${part}`, mode, { ...tone, sidebar: tone.page } as Tone, theme] as const)),
]);

it('lists each theme under its own id', () => {
  expect(Object.entries<Theme>(THEMES).map(([id, theme]) => theme.id === id)).not.toContain(false);
});

it.each(themed)('states the %s theme in %s as six-digit colours', (_, __, tone) => {
  for (const color of Object.values(tone)) expect(color).toMatch(/^#[\da-f]{6}$/);
});

it.each(themed)('keeps the %s theme in %s to the faint text rule, on the rungs it states and the ones the rule gives it', (_, mode, tone) => {
  const fills = fillsOf(mode, tone);
  const faint = tone.faint ?? color(mode === 'dark' ? dark! : light!, 'text-faint');
  const muted = tone.muted ?? color(mode === 'dark' ? dark! : light!, 'text-muted');
  for (const fill of fills) expect(contrast(faint, fill)).toBeGreaterThanOrEqual(4.5);
  expect(Math.abs(lightness(faint) - lightness(muted))).toBeGreaterThanOrEqual(4);
});

it.each(themed)('keeps a name the %s theme states in %s readable on its page', (_, __, tone) => {
  if (tone.name) expect(contrast(tone.name, tone.page)).toBeGreaterThanOrEqual(4.5);
});

it.each(themed)('keeps what the %s theme states on its accent in %s readable there, at rest and under a pointer', (_, mode, tone) => {
  if (!tone.onAccent) return;
  for (const fill of [tone.accent, tone.accentHover ?? mixed(mode, 'accent', 'accent-hover', tone.accent)]) expect(contrast(tone.onAccent, fill)).toBeGreaterThanOrEqual(4.5);
});

it.each(themed)('keeps what the %s theme states on its send button in %s readable there', (_, __, tone) => {
  if (tone.onSend) expect(contrast(tone.onSend, tone.send ?? tone.accent)).toBeGreaterThanOrEqual(4.5);
});

it.each(themed)('keeps the words, the dialogue, the action voice and what is read in the accent of the %s theme in %s readable on its page, and in the bubble fill where its message shape draws with it', (_, mode, tone, theme) => {
  const action = tone.action ?? color(mode === 'dark' ? dark! : light!, 'prose-action');
  const fills = [tone.page, ...(['bubble', 'page'].includes(theme.shapes.message) ? [tone.bubble ?? tone.surface ?? rung(mode, 'surface', tone.page)] : [])];
  for (const fill of fills) for (const ink of [tone.text, tone.dialogue, action, tone.mark ?? tone.accent]) expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5);
});

// 기본's accent clears this on the same fills, so a theme is held to it too: by its accent, or by the mark it states.
it.each(themed)('keeps what is read in the accent of the %s theme in %s at AA on the fills words stand on', (_, mode, tone) => {
  const fills = fillsOf(mode, tone);
  for (const fill of fills) expect(contrast(tone.mark ?? tone.accent, fill)).toBeGreaterThanOrEqual(4.5);
});

it('writes a finish as token rules for the element that names the theme, a stated name for the base 배경 and 강조 only, and a mark for the base 강조 on any page', () => {
  const tones = { dark: { page: '#101010', text: '#f0f0f0', accent: '#8080ff', dialogue: '#ffffff', name: '#ffcc00' }, light: { page: '#ffffff', text: '#101010', accent: '#3030c0', dialogue: '#000000' } };
  const plain = themeRules({ ...BASE, id: 'night', name: '밤', tones });
  expect(plain).toContain("[data-theme='night'][data-mode='dark'][data-bg='base'][data-accent='base']{--color-name:#ffcc00;}");
  expect(themeRules({ ...BASE, id: 'night', name: '밤', tones: { ...tones, light: { ...tones.light, mark: '#2020a0' } } })).toContain("[data-theme='night'][data-mode='light'][data-accent='base']{--color-accent-mark:#2020a0;}");
  expect(themeRules({ ...BASE, id: 'night', name: '밤', tones: { ...tones, light: { ...tones.light, action: '#404040', bubble: '#f0f0f0', current: '#e0e0e0' } } })).toContain("[data-theme='night'][data-mode='light'][data-bg='base']{--color-row-current:#e0e0e0;--color-bubble:#f0f0f0;}[data-theme='night'][data-mode='light'][data-dialogue='base']{--color-prose-action:#404040;}");
  expect(themeRules(THEMES.kakaotalk)).toContain("[data-theme='kakaotalk/room/light'][data-mode='light'][data-bg='base']{--color-name:#2b3540;}");
  expect(plain).not.toContain('[data-mode]{');
  expect(themeRules({ ...BASE, id: 'night', name: '밤', tones, finish: { rows: 'close', faces: 'round', lines: 'close', speakers: 'large', corners: 'tight', dock: 'flush' } })).toBe(
    plain +
      "[data-theme='night'][data-mode]{--story-gap:var(--story-gap-close);--face-radius-sm:var(--radius-full);--face-radius-md:var(--radius-full);--face-radius-rail:var(--radius-full);--face-radius-lg:var(--radius-full);--reading-leading-narrow:var(--prose-leading-close-narrow);--reading-leading-normal:var(--prose-leading-close-normal);--reading-leading-wide:var(--prose-leading-close-wide);--reading-leading-widest:var(--prose-leading-close-widest);--avatar-story:var(--avatar-rail);--avatar-story-letter:var(--text-lg);--radius-sm:var(--radius-tight-sm);--radius-md:var(--radius-tight);--radius-lg:var(--radius-tight);--dock-inset:0;}",
  );
});

it('writes a part under a name of its own by the page\'s mode, its page the sidebar\'s ground, with the theme\'s finish', () => {
  const tones = { dark: { page: '#101010', text: '#f0f0f0', accent: '#8080ff', dialogue: '#ffffff' }, light: { page: '#ffffff', text: '#101010', accent: '#3030c0', dialogue: '#000000' } };
  const side = { light: { mode: 'dark' as const, tone: { page: '#300030', text: '#f0e0f0', accent: '#80c0ff', dialogue: '#f0e0f0', muted: '#c0b0c0' } } };
  const plain = themeRules({ ...BASE, id: 'night', name: '밤', tones });
  expect(themeRules({ ...BASE, id: 'night', name: '밤', tones, side })).toBe(
    plain +
      "[data-theme='night/side/light'][data-mode='dark']{--color-pick-bg-base:#300030;--color-pick-ink-base:#f0e0f0;--color-pick-accent-base:#80c0ff;--color-pick-dialogue-base:#f0e0f0;--color-text-muted:#c0b0c0;}" +
      "[data-theme='night/side/light'][data-mode='dark'][data-bg='base']{--color-sidebar:#300030;}",
  );
  expect(themeRules({ ...BASE, id: 'night', name: '밤', tones, side, finish: { ...BASE.finish, rows: 'close' } })).toContain("[data-theme='night'][data-mode]{--story-gap:var(--story-gap-close);}[data-theme='night/side/light'][data-mode]{--story-gap:var(--story-gap-close);}");
});

it('gives a finish of its own only to a theme with tones, the only kind an element names', () => {
  for (const theme of Object.values<Theme>(THEMES)) expect(Boolean(theme.tones) || JSON.stringify(theme.finish) === JSON.stringify(BASE.finish)).toBe(true);
});

it('names a theme on a scheme element only when it has colours of its own, and gives its rungs only to the base page', () => {
  expect(schemeAttributes(WORN, BASE)['data-theme']).toBeUndefined();
  expect(themeRules(BASE)).toBe('');
  expect(schemeAttributes(WORN, THEMES.discord)['data-theme']).toBe('discord');
  const tones = { dark: { page: '#101010', text: '#f0f0f0', accent: '#8080ff', dialogue: '#ffffff', sidebar: '#0a0a0a', line: '#303030', muted: '#b0b0b0' }, light: { page: '#ffffff', text: '#101010', accent: '#3030c0', dialogue: '#000000' } };
  expect(themeRules({ ...BASE, id: 'night', name: '밤', tones })).toBe(
    "[data-theme='night'][data-mode='dark']{--color-pick-bg-base:#101010;--color-pick-ink-base:#f0f0f0;--color-pick-accent-base:#8080ff;--color-pick-dialogue-base:#ffffff;--color-text-muted:#b0b0b0;}" +
      "[data-theme='night'][data-mode='dark'][data-bg='base']{--color-sidebar:#0a0a0a;--color-divider:#303030;--color-border:#303030;}" +
      "[data-theme='night'][data-mode='light']{--color-pick-bg-base:#ffffff;--color-pick-ink-base:#101010;--color-pick-accent-base:#3030c0;--color-pick-dialogue-base:#000000;}",
  );
});
