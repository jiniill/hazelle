import { expect, it } from 'vitest';
import tokens from './tokens.css?raw';

const palette = new Map([...tokens.matchAll(/--(palette-[\w-]+): (#[\da-f]{6});/g)].map((match) => [match[1]!, match[2]!]));
const [, dark, light] = /\n\[data-theme='dark'\] \{([\s\S]*?)\n\}[\s\S]*?\n\[data-theme='light'\] \{([\s\S]*?)\n\}/.exec(tokens)!;

function color(theme: string, role: string): string {
  const name = new RegExp(`--color-${role}: var\\(--(palette-[\\w-]+)\\);`).exec(theme)![1]!;
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

it.each([['dark', dark!], ['light', light!]])('keeps %s faint text at AA on every row fill but the current one, a rung from muted', (_, theme) => {
  const faint = color(theme, 'text-faint');
  for (const fill of FILLS) expect(contrast(faint, color(theme, fill))).toBeGreaterThanOrEqual(4.5);
  expect(Math.abs(lightness(faint) - lightness(color(theme, 'text-muted')))).toBeGreaterThanOrEqual(4);
});
