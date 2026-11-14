import { createContext, useContext } from 'react';
import type { FontId } from './fonts';
import { MODE, SchemeContext, schemeAttributes, type Mode, type Scheme } from './scheme';

// One mode's colours as a theme states them, each #rrggbb. page, text, accent and dialogue stand where a 색 pick's
// 기본 does, and tokens.css derives the rest from them by the picks' rules; a rung stated here goes over the rule's.
// line is a divider's and a control's outline both, outline the control's where it is not the divider's. rail left out is the sidebar's; muted and faint left out stay the
// mode's; name, a speaker's in the story, left out is the mark's, and is stated for the theme's own page. pointed is
// the ground under a message the pointer is on, none when left out. current is the fill of the row that is open in
// a list, raised's when left out. bubble is the fill a message shape boxes
// words in where the box is not the accent's: the others' speech bubbles, a page's box of mine; the surface's when
// left out. action is the story's action voice, the mode's when left out,
// and is stated when that is too dim on the theme's page or bubble. mark is the accent where it is read, as words,
// icons and the focus ring: left out is the accent, and is stated when that is too dim on the theme's fills.
// onAccent is what stands on an accent fill, a button's words and a switch's knob, and accentHover that fill under
// a pointer: left out are the rule's. send and onSend are the send button's fill and what stands on it, the accent's
// when left out.
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
  outline?: string;
  muted?: string;
  faint?: string;
  name?: string;
  pointed?: string;
  current?: string;
  bubble?: string;
  action?: string;
  mark?: string;
  onAccent?: string;
  accentHover?: string;
  send?: string;
  onSend?: string;
};

// A region's shape by name: which arrangement the kit component that draws the region takes. The first of each is
// 기본's. A component maps its region's names to classes with a Record over them, so a name it does not draw does
// not build.
export type Shapes = {
  header: 'plain' | 'topic' | 'bare';
  rail: 'icons' | 'servers' | 'labels';
  list: 'cards' | 'titles' | 'channels' | 'people';
  composer: 'box' | 'bar' | 'toolbar';
  message: 'prose' | 'page' | 'row' | 'bubble';
  day: 'rule' | 'pill';
};

export type Spacing = 'narrow' | 'normal' | 'wide' | 'widest';
// 읽기 폭's steps: full has no cap, so the story is as wide as its column.
export type Width = Spacing | 'full';

// 글꼴, 글자 크기, 줄 간격 and 읽기 폭: what 읽기 sets. A theme that states them starts with its own, and the reader's
// changes while wearing it are kept as that theme's, apart from the ones made in a theme that states none.
export type Letters = { font: FontId; size: number; leading: Spacing; width: Width };

// What a theme sets of the things no reader's setting owns, each by name: the values are tokens.css's. The first of
// each is 기본's and writes no rule. Only a theme with tones is named on its
// element (tokens.css mixes a named theme's rungs from its page), so a finish rides on tones: a theme in 기본's
// colours with a finish of its own needs a name that mixes nothing first.
export type Finish = {
  // The gap between one message and the next.
  rows: 'open' | 'close';
  // The corners of a face Avatar draws.
  faces: 'soft' | 'round' | 'squircle';
  // The scale 줄 간격's four steps stand on in a chat; a story drawn outside one keeps the app's.
  lines: 'open' | 'close';
  // The size of the speaker's face beside a message.
  speakers: 'small' | 'medium' | 'large';
  // The corners of boxes, rows and controls: the radius scale from sm to lg.
  corners: 'soft' | 'tight' | 'round';
  // How the composer stands at the column's foot: inset from its sides and foot, that with a shadow under it, or
  // flush with them, as wide as the column and square.
  dock: 'inset' | 'lifted' | 'flush';
};

// A part of the frame a theme draws in colours other than its page's: the mode it takes and its colours there. Its
// page is its own ground, the sidebar's too.
export type Part = { mode: Mode; tone: Omit<Tone, 'sidebar'> };
// side: the rail and the sidebar. room: a chat's column, under its header and around its composer.
const PARTS = ['side', 'room'] as const;
type Parts = { [Name in (typeof PARTS)[number]]?: Partial<Record<Mode, Part>> };

// tones left out is the app's own colours, as tokens.css has them. A part is by the page's mode, and rides on tones.
export type Theme = { id: string; name: string; tones?: Record<Mode, Tone>; shapes: Shapes; finish: Finish; letters?: Letters } & Parts;

export const BASE: Theme = { id: 'base', name: '기본', shapes: { header: 'plain', rail: 'icons', list: 'cards', composer: 'box', message: 'prose', day: 'rule' }, finish: { rows: 'open', faces: 'soft', lines: 'open', speakers: 'small', corners: 'soft', dock: 'inset' } };

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
  outline: ['--color-border'],
  pointed: ['--color-row-pointed'],
  current: ['--color-row-current'],
  bubble: ['--color-bubble'],
};
// A 강조 pick colours the names too, as it does in 기본, and a name is stated against the theme's page, so a theme's
// holds only while both picks are base. A part's holds under a 강조 pick as well: a pick's colours are made for the
// mode's page, and a part's ground is not it.
const VOICE: Partial<Record<keyof Tone, string[]>> = { name: ['--color-name'] };
// 대사's 무채색 pick sets the action voice with it, so a theme's holds only while that pick is base.
const SPOKEN: Partial<Record<keyof Tone, string[]>> = { action: ['--color-prose-action'] };
// What is read in the accent and what stands on it follow a 강조 pick as well, but no 배경 pick changes the accent,
// so a theme's hold on any page while 강조 is base; a name not held then is the mark's (tokens.css).
const ACCENTED: Partial<Record<keyof Tone, string[]>> = { mark: ['--color-accent-mark'], onAccent: ['--color-on-accent'], accentHover: ['--color-accent-hover'], send: ['--color-send'], onSend: ['--color-on-send'] };

const faces = (radius: string) => ['sm', 'md', 'rail', 'lg'].map((size) => `--face-radius-${size}:var(--radius-${radius});`).join('');
const FINISH: { [Part in keyof Finish]: Record<Finish[Part], string> } = {
  rows: { open: '', close: '--story-gap:var(--story-gap-close);' },
  faces: { soft: '', round: faces('full'), squircle: faces('squircle') },
  lines: { open: '', close: ['narrow', 'normal', 'wide', 'widest'].map((step) => `--reading-leading-${step}:var(--prose-leading-close-${step});`).join('') },
  speakers: { small: '', medium: '--avatar-story:var(--avatar-story-medium);', large: '--avatar-story:var(--avatar-rail);--avatar-story-letter:var(--text-lg);' },
  corners: { soft: '', tight: '--radius-sm:var(--radius-tight-sm);--radius-md:var(--radius-tight);--radius-lg:var(--radius-tight);', round: '--radius-lg:var(--radius-round);' },
  dock: { inset: '', lifted: '--dock-shadow:var(--shadow-dock);', flush: '--dock-inset:0;' },
};

function rule(selector: string, tone: Tone, tokens: Partial<Record<keyof Tone, string[]>>) {
  const declared = (Object.keys(tokens) as (keyof Tone)[]).flatMap((key) => (tone[key] === undefined ? [] : tokens[key]!.map((token) => `${token}:${tone[key]};`)));
  return declared.length > 0 ? `${selector}{${declared.join('')}}` : '';
}

function toneRules(name: string, mode: Mode, tone: Tone, part = false) {
  const worn = `[data-theme='${name}'][data-mode='${mode}']`;
  return rule(worn, tone, OWN) + rule(`${worn}[data-bg='base']`, tone, GROUND) + rule(`${worn}[data-bg='base']${part ? '' : "[data-accent='base']"}`, tone, VOICE) + rule(`${worn}[data-accent='base']`, tone, ACCENTED) + rule(`${worn}[data-dialogue='base']`, tone, SPOKEN);
}

// A part is named apart from its theme, by the page's mode: under the theme's own name the theme's colours for the
// mode the part takes would stand wherever the part states none.
const partName = (id: string, part: keyof Parts, page: Mode) => `${id}/${part}/${page}`;

// A theme's rules, read after tokens.css: each matches the element that names the theme and a mode, as an element
// drawn in another scheme does (schemeAttributes), so nothing reaches an element that names neither. A part's are
// its theme's again under the part's name: its colours, the sidebar's ground being its page, and the finish.
export function themeRules(theme: Theme): string {
  const { id, tones, finish } = theme;
  if (!tones) return '';
  const picked = (Object.keys(FINISH) as (keyof Finish)[]).map((part) => (FINISH[part] as Record<string, string>)[finish[part]]).join('');
  const modes = Object.keys(MODE) as Mode[];
  const parts = PARTS.flatMap((part) => modes.flatMap((page) => (theme[part]?.[page] ? [{ name: partName(id, part, page), ...theme[part][page] }] : [])));
  const colours = [...modes.map((mode) => toneRules(id, mode, tones[mode])), ...parts.map(({ name, mode, tone }) => toneRules(name, mode, { ...tone, sidebar: tone.page }, true))];
  return colours.join('') + (picked ? [id, ...parts.map(({ name }) => name)].map((name) => `[data-theme='${name}'][data-mode]{${picked}}`).join('') : '');
}

// What a part's element puts on itself: the part's scheme under a theme that states one for the mode of the scheme it
// is drawn in (its own, as a chat in a character's look has, or the worn one), nothing otherwise. Not while a 배경
// is picked: a theme's rungs give way to a pick's, and so do its parts.
export function usePart(part: keyof Parts, own?: Scheme) {
  const theme = useContext(ThemeContext);
  const worn = useContext(SchemeContext);
  const scheme = own ?? worn;
  const stated = scheme.bg === 'base' ? theme[part]?.[scheme.mode] : undefined;
  return stated && { ...schemeAttributes({ ...scheme, mode: stated.mode }, theme), 'data-theme': partName(theme.id, part, scheme.mode) };
}

// Once, before the first paint: a constructed sheet stands after the document's own, so a theme's rungs go over the
// pick rules of the same weight.
export function adoptThemes(themes: Theme[]) {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(themes.map(themeRules).join(''));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
