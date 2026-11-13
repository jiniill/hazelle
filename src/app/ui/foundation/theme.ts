import { createContext, useContext } from 'react';
import type { FontId } from './fonts';
import { MODE, type Mode } from './scheme';

// One mode's colours as a theme states them, each #rrggbb. page, text, accent and dialogue stand where a 색 pick's
// 기본 does, and tokens.css derives the rest from them by the picks' rules; a rung stated here goes over the rule's.
// line is a divider's and a control's outline both. rail left out is the sidebar's; muted and faint left out stay the
// mode's; name, a speaker's in the story, left out is the accent, and is stated for the theme's own page. pointed is
// the ground under a message the pointer is on, none when left out.
export type Tone = {
  page: string;
  text: string;
  accent: string;
  dialogue: string;
  sidebar?: string;
  rail?: string;
  surface?: string;
  hover?: string;
  raised?: string;
  line?: string;
  muted?: string;
  faint?: string;
  name?: string;
  pointed?: string;
};

// A region's shape by name: which arrangement the kit component that draws the region takes. The first of each is
// 기본's. A component maps its region's names to classes with a Record over them, so a name it does not draw does
// not build.
export type Shapes = {
  header: 'plain' | 'topic';
  rail: 'icons' | 'servers';
  list: 'cards' | 'channels';
  composer: 'box' | 'bar';
  message: 'prose' | 'row';
};

export type Spacing = 'narrow' | 'normal' | 'wide' | 'widest';

// 글꼴, 글자 크기, 줄 간격 and 읽기 폭: what 읽기 sets. A theme that states them starts with its own, and the reader's
// changes while wearing it are kept as that theme's, apart from the ones made in a theme that states none.
export type Letters = { font: FontId; size: number; leading: Spacing; width: Spacing };

// What a theme sets of the things no reader's setting owns, each by name: the values are tokens.css's. The first of
// each is 기본's and writes no rule. Only a theme with tones is named on its
// element (tokens.css mixes a named theme's rungs from its page), so a finish rides on tones: a theme in 기본's
// colours with a finish of its own needs a name that mixes nothing first.
export type Finish = {
  // The gap between one message and the next.
  rows: 'open' | 'close';
  // The corners of a face Avatar draws.
  faces: 'soft' | 'round';
  // The scale 줄 간격's four steps stand on.
  lines: 'open' | 'close';
};

// tones left out is the app's own colours, as tokens.css has them.
export type Theme = { id: string; name: string; tones?: Record<Mode, Tone>; shapes: Shapes; finish: Finish; letters?: Letters };

export const BASE: Theme = { id: 'base', name: '기본', shapes: { header: 'plain', rail: 'icons', list: 'cards', composer: 'box', message: 'prose' }, finish: { rows: 'open', faces: 'soft', lines: 'open' } };

// The theme the app wears: an element drawn in a scheme of its own inside it names it, and a component reads its
// region's shape from it. A theme's card provides its own.
export const ThemeContext = createContext(BASE);

export const useShape = <Region extends keyof Shapes>(region: Region): Shapes[Region] => useContext(ThemeContext).shapes[region];

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
  rail: ['--color-rail'],
  surface: ['--color-surface'],
  hover: ['--color-surface-hover'],
  raised: ['--color-surface-raised'],
  line: ['--color-divider', '--color-border'],
  pointed: ['--color-row-pointed'],
};
// A 강조 pick colours the names too, as it does in 기본, and a name is stated against the theme's page, so a theme's
// holds only while both picks are base.
const VOICE: Partial<Record<keyof Tone, string[]>> = { name: ['--color-name'] };

const FINISH: { [Part in keyof Finish]: Record<Finish[Part], string> } = {
  rows: { open: '', close: '--story-gap:var(--story-gap-close);' },
  faces: { soft: '', round: ['sm', 'md', 'rail', 'lg'].map((size) => `--face-radius-${size}:var(--radius-full);`).join('') },
  lines: { open: '', close: ['narrow', 'normal', 'wide', 'widest'].map((step) => `--prose-leading-${step}:var(--prose-leading-close-${step});`).join('') },
};

function rule(selector: string, tone: Tone, tokens: Partial<Record<keyof Tone, string[]>>) {
  const declared = (Object.keys(tokens) as (keyof Tone)[]).flatMap((key) => (tone[key] === undefined ? [] : tokens[key]!.map((token) => `${token}:${tone[key]};`)));
  return declared.length > 0 ? `${selector}{${declared.join('')}}` : '';
}

// A theme's rules, read after tokens.css: each matches the element that names the theme and a mode, as an element
// drawn in another scheme does (schemeAttributes), so nothing reaches an element that names neither.
export function themeRules({ id, tones, finish }: Theme): string {
  if (!tones) return '';
  const picked = (Object.keys(FINISH) as (keyof Finish)[]).map((part) => (FINISH[part] as Record<string, string>)[finish[part]]).join('');
  const colours = (Object.keys(MODE) as Mode[]).map((mode) => {
    const worn = `[data-theme='${id}'][data-mode='${mode}']`;
    return rule(worn, tones[mode], OWN) + rule(`${worn}[data-bg='base']`, tones[mode], GROUND) + rule(`${worn}[data-bg='base'][data-accent='base']`, tones[mode], VOICE);
  });
  return colours.join('') + (picked ? `[data-theme='${id}'][data-mode]{${picked}}` : '');
}

// Once, before the first paint: a constructed sheet stands after the document's own, so a theme's rungs go over the
// pick rules of the same weight.
export function adoptThemes(themes: Theme[]) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(themes.map(themeRules).join(''));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
