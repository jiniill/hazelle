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

// The rung a 배경 pick's rule gives a page: a share of white or black over it, mixed in oklab.
function rung(mode: Mode, role: string, page: string): string {
  const rules = new RegExp(`\\[data-mode='${mode}'\\]:is\\(\\[data-bg\\][^{]*\\{([\\s\\S]*?)\\n\\}`).exec(tokens)![1]!;
  const [, tint, share] = new RegExp(`--color-${role}: color-mix\\(in oklab, var\\(--palette-(white|black)\\) ([\\d.]+)%, var\\(--color-pick-bg\\)\\);`).exec(rules)!;
  const [over, under] = [oklab(tint === 'white' ? '#ffffff' : '#000000'), oklab(page)];
  return hexOf(over.map((value, at) => (Number(share) / 100) * value + (1 - Number(share) / 100) * under[at]!));
}

const WORN: Scheme = { mode: 'dark', bg: 'base', ink: 'base', accent: 'base', dialogue: 'base' };
const themed = Object.values<Theme>(THEMES).flatMap((theme) => (theme.tones ? (Object.entries(theme.tones) as [Mode, Tone][]).map((tone) => [theme.id, ...tone] as const) : []));

it('lists each theme under its own id', () => {
  expect(Object.entries<Theme>(THEMES).map(([id, theme]) => theme.id === id)).not.toContain(false);
});

it.each(themed)('states the %s theme in %s as six-digit colours', (_, __, tone) => {
  for (const color of Object.values(tone)) expect(color).toMatch(/^#[\da-f]{6}$/);
});

it.each(themed)('keeps the %s theme in %s to the faint text rule, on the rungs it states and the ones the rule gives it', (_, mode, tone) => {
  const fills = [tone.page, tone.sidebar ?? rung(mode, 'sidebar', tone.page), tone.surface ?? rung(mode, 'surface', tone.page), tone.hover ?? rung(mode, 'surface-hover', tone.page)];
  const faint = tone.faint ?? color(mode === 'dark' ? dark! : light!, 'text-faint');
  const muted = tone.muted ?? color(mode === 'dark' ? dark! : light!, 'text-muted');
  for (const fill of fills) expect(contrast(faint, fill)).toBeGreaterThanOrEqual(4.5);
  expect(Math.abs(lightness(faint) - lightness(muted))).toBeGreaterThanOrEqual(4);
});

it('names a theme on a scheme element only when it has colours of its own, and gives its rungs only to the base page', () => {
  expect(schemeAttributes(WORN, BASE)['data-theme']).toBeUndefined();
  expect(themeRules(BASE)).toBe('');
  expect(schemeAttributes(WORN, THEMES.channel)['data-theme']).toBe('channel');
  const tones = { dark: { page: '#101010', text: '#f0f0f0', accent: '#8080ff', dialogue: '#ffffff', sidebar: '#0a0a0a', line: '#303030', muted: '#b0b0b0' }, light: { page: '#ffffff', text: '#101010', accent: '#3030c0', dialogue: '#000000' } };
  expect(themeRules({ ...BASE, id: 'night', name: '밤', tones })).toBe(
    "[data-theme='night'][data-mode='dark']{--color-pick-bg-base:#101010;--color-pick-ink-base:#f0f0f0;--color-pick-accent-base:#8080ff;--color-pick-dialogue-base:#ffffff;--color-text-muted:#b0b0b0;}" +
      "[data-theme='night'][data-mode='dark'][data-bg='base']{--color-sidebar:#0a0a0a;--color-divider:#303030;--color-border:#303030;}" +
      "[data-theme='night'][data-mode='light']{--color-pick-bg-base:#ffffff;--color-pick-ink-base:#101010;--color-pick-accent-base:#3030c0;--color-pick-dialogue-base:#000000;}",
  );
});
