import { createContext } from 'react';
import { MODE, type Mode } from './scheme';

// One mode's colours as a theme states them, each #rrggbb. page, text, accent and dialogue stand where a 색 pick's
// 기본 does, and tokens.css derives the rest from them by the picks' rules; a rung stated here goes over the rule's.
// line is a divider's and a control's outline both. muted and faint left out stay the mode's.
export type Tone = {
  page: string;
  text: string;
  accent: string;
  dialogue: string;
  sidebar?: string;
  surface?: string;
  hover?: string;
  raised?: string;
  line?: string;
  muted?: string;
  faint?: string;
};

// tones left out is the app's own colours, as tokens.css has them.
export type Theme = { id: string; name: string; tones?: Record<Mode, Tone> };

export const BASE: Theme = { id: 'base', name: '기본' };

// The theme the app wears, for an element drawn in a scheme of its own inside it.
export const ThemeContext = createContext(BASE);

const OWN: Partial<Record<keyof Tone, string[]>> = {
  page: ['--color-pick-bg-base'],
  text: ['--color-pick-ink-base'],
  accent: ['--color-pick-accent-base'],
  dialogue: ['--color-pick-dialogue-base'],
  muted: ['--color-text-muted'],
  faint: ['--color-text-faint'],
};
// The rungs a 배경 pick derives again from its own colour, so a theme's hold only while that pick is base.
const GROUND: Partial<Record<keyof Tone, string[]>> = {
  sidebar: ['--color-sidebar'],
  surface: ['--color-surface'],
  hover: ['--color-surface-hover'],
  raised: ['--color-surface-raised'],
  line: ['--color-divider', '--color-border'],
};

function rule(selector: string, tone: Tone, tokens: Partial<Record<keyof Tone, string[]>>) {
  const declared = (Object.keys(tokens) as (keyof Tone)[]).flatMap((key) => (tone[key] === undefined ? [] : tokens[key]!.map((token) => `${token}:${tone[key]};`)));
  return declared.length > 0 ? `${selector}{${declared.join('')}}` : '';
}

// A theme's rules, read after tokens.css: each matches the element that names the theme and a mode, as an element
// drawn in another scheme does (schemeAttributes), so nothing reaches an element that names neither.
export function themeRules({ id, tones }: Theme): string {
  if (!tones) return '';
  return (Object.keys(MODE) as Mode[])
    .map((mode) => {
      const worn = `[data-theme='${id}'][data-mode='${mode}']`;
      return rule(worn, tones[mode], OWN) + rule(`${worn}[data-bg='base']`, tones[mode], GROUND);
    })
    .join('');
}

// Once, before the first paint: a constructed sheet stands after the document's own, so a theme's rungs go over the
// pick rules of the same weight.
export function adoptThemes(themes: Theme[]) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(themes.map(themeRules).join(''));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
