import DOMPurify from 'dompurify';
import { createContext, useContext, useEffect, useLayoutEffect, useReducer, useRef, type ReactNode, type Ref } from 'react';
import { useRowState } from '../collections/row-memory';
import { scrollbarKind } from '../foundation/scrollbar';
import { useQuoteShape } from '../foundation/quotes';
import { useVeil, type Veil } from '../foundation/veil';
import { inlaid } from './inlay';
import { useMarginRoom } from '../layout/ChatFrame';
import { MarginPictures } from './MarginPictures';
import type { SelectionEnd } from './SelectionButton';
import { useCode } from './code';
import { useMath } from './math';
import styles from './Story.module.css';
import shadowCss from './Story.shadow.css?inline';

// One of the bot's buttons, as its HTML names it: risu-trigger names a function of its script, risu-btn carries data to it.
// id: the trigger's element's risu-id, which {{triggerid}} reads; '' when it has none.
export type BotButton = { trigger: string; id: string } | { data: string };

type Inlay = { mark: string | null; node: ReactNode };

type Props = {
  html: string;
  css?: string;
  cursor?: boolean;
  tone?: 'plain' | 'faded';
  buttons?: 'live' | 'inert';
  // A press on one of the bot's buttons; null for a plain button, which names nothing to run.
  onPress?: (button: BotButton | null) => void;
  // Lit wherever a text node holds it; lower case and NFC, as the caller's search folds it. '' for none.
  term?: string;
  // Every picture open, for a page drawn once where nothing can be tapped open (snapshot).
  whole?: boolean;
  // Each put where its mark stands in html (inlaid), or at the end for a mark null, such as a part being edited.
  inlays?: Inlay[];
  // The message's 삽화, each by its mark as an inlay is, or on the stage beside the story where the chat has room for it.
  illustrations?: Inlay[];
  // The element storySelection reads.
  ref?: Ref<HTMLDivElement>;
};

const NAMED = '[risu-trigger], [risu-btn]';
// Named in Story.shadow.css.
const PICTURE = 'data-picture';
// Opened by a tap, and kept open (pictures); opened while the pointer is over it.
const OPEN = 'data-open';
const HOVER = 'data-hover';
// Named in Story.shadow.css: on a picture's line whose picture is wider than tall, which CSS cannot tell.
const WIDE = 'data-wide';
const PICTURES = Symbol('pictures');
// Named in Story.shadow.css. Holds the source of the picture or video it stands in for.
const VEILED = 'data-veiled';
// Named in Story.shadow.css. Holds the source of the picture or video tapped open that it covers again.
const COVER = 'data-cover';
// Named in Story.shadow.css and snapshot.ts, which leaves it out of an export. A code block's copy button: its words are
// the attribute's value, drawn by CSS, so they are no text of the story's (search, selection).
const COPY = 'data-copy';
// Named in Story.shadow.css and in engine/assets.ts (inlayMissing), whose mark stands where a chat's inlay is missing.
const INLAY_MISSING = 'data-inlay-missing';
// Named in Story.shadow.css and in engine/assets.ts (placeTextFiles): a text file's name, empty for one the chat lacks.
const TEXTFILE = 'data-textfile';
// Named in Story.shadow.css. chat/withOriginal ends each line of an original shown under its translation with the mark,
// last so a line's own markdown (# , - , a bot's <div) still reads; the block it ends takes the attribute.
const ORIGINAL = 'data-original';
export const ORIGINAL_MARK = '';
const ORIGINAL_BLOCK = 'p, li, h1, h2, h3, h4, h5, h6';
const pictureKey = (picture: Element) => `${picture.getAttribute(PICTURE)}:${picture.querySelector('img')!.getAttribute('src')}`;
// Sent from a message when the reader opens or closes one of its pictures, so the chat keeps its view where it is.
export const READER_RESIZED = 'readerresized';
// The CSP refuses a style attribute, even in the document the sanitizer parses into, so each is renamed before the
// parse and applied through CSSOM, which the CSP allows. A DOMPurify hook would come too late: hooks run after the parse.
// One match per tag, up to its first > (a > inside a quoted value ends it, as it always has), or to the end for a tag
// never closed: a lazy scan from every < rescanned the rest of the text for each < with no > after it.
const TAG = /<[a-z][^>]*(?:>|$)/gi;
const STYLE_ATTRIBUTE = /(\s)style(?=\s*=)/gi;
const SET_ASIDE = 'data-style';
export const setStylesAside = (html: string) => html.replace(TAG, (tag) => tag.replace(STYLE_ATTRIBUTE, `$1${SET_ASIDE}`));
// No form: the CSP does not limit where one posts. DOMPurify's own URL rule, with blob: added for the bots' pictures;
// sanitize then keeps only the app's own sources and web links. No popover or command: either opens an element in
// the top layer, which no containment holds, without a script. KaTeX's MathML (math.ts) wraps a formula in semantics and
// its TeX in annotation, which DOMPurify drops by default while keeping their text: the TeX would show beside it.
const CONFIG = {
  RETURN_DOM_FRAGMENT: true as const,
  ADD_TAGS: ['semantics', 'annotation'],
  FORBID_TAGS: ['form', 'style'],
  FORBID_ATTR: ['style', 'popover', 'popovertarget', 'popovertargetaction', 'command', 'commandfor'],
  ADD_ATTR: ['risu-btn', 'risu-trigger', 'risu-id', 'risu-mark'],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};
const VOID = new Set(['BR', 'HR', 'IMG', 'INPUT', 'WBR']);
const HTML = 'http://www.w3.org/1999/xhtml';
// An url( never closed runs to the end, as CSS reads it, and goes whole: matching only a closed one rescanned the rest
// of the text for each url(. The look-ahead takes the spaces itself: \s* giving one back would let url( "blob:…" ) past it.
const OUTSIDE_URL = /url\((?![\s'"]*(?:data|blob):)[^)]*(?:\)|$)/gi;
const ANY_URL = /url\([^)]*(?:\)|$)/gi;
// data: pictures, and blob: ones, which only the app itself can make: the chat puts its bots' pictures there.
const OWN_SOURCE = /^(?:data|blob):/;
const XLINK = 'http://www.w3.org/1999/xlink';
// Named in Story.shadow.css. One registry entry, which every mounted story adds its own ranges to.
const FOUND_TERM = 'found-term';
let foundTerm: Highlight | null = null;

// A term split across elements (he<em>llo</em>) is not lit, nor one in a node whose folding changes its length, where
// the offsets would lie; the message's own mark still shows it.
function termRanges(shadow: ShadowRoot, term: string): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(shadow, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const text = node.data.normalize('NFC').toLowerCase();
    if (text.length !== node.data.length) continue;
    for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
      const range = new Range();
      range.setStart(node, at);
      range.setEnd(node, at + term.length);
      ranges.push(range);
    }
  }
  return ranges;
}

// For a stylesheet and a style attribute alike. Risu prefixes every class with x-risu- in the HTML and in the CSS, so
// a bot may write either, and both lose it. Only the app's own URLs load: the CSP refuses the others anyway.
// While 이미지 가리기 is on, the app's own URLs go too: a bot draws its pictures as backgrounds as well.
// @import is left to the constructed stylesheet, which drops it. A pattern cut it at the first ;, which a font URL
// holds inside its quotes (wght@600;700), and the rest of the URL swallowed the bot's next rule.
// Risu re-reads a bot's CSS through a parser, which drops the non-breaking spaces some bots indent it with; a browser
// reads one ahead of a selector as part of it, and the rule matches nothing. One inside a quoted string is the bot's
// text; a comment is skipped whole, as its apostrophe opens no string. Both end where CSS ends them (a string at its
// line, a comment at the end), so an unclosed one is no rescan.
const NBSP_OUTSIDE_STRINGS = /(\/\*[\s\S]*?(?:\*\/|$)|"(?:\\[\s\S]|[^"\\\n])*"?|'(?:\\[\s\S]|[^'\\\n])*'?)|\u00a0/g;
export const cleanCss = (css: string, veiled: boolean) => css.replace(NBSP_OUTSIDE_STRINGS, (_, quoted?: string) => quoted ?? ' ').replaceAll('.x-risu-', '.').replace(veiled ? ANY_URL : OUTSIDE_URL, 'none');

// A fixed box would be placed and cut by the message that holds it (Story.module.css): a console centred on Risu's
// screen shrank to a sliver in an otherwise empty message. It stands where it is written instead, and its offsets and
// transform go with fixed, since they placed it on the screen (top: 50% with translate(-50%, -50%) to centre it).
const SCREEN_PLACEMENT = ['top', 'right', 'bottom', 'left', 'inset', 'transform', 'translate'];
// The screen's whole width or height: a backdrop over Risu's page would stand as a screen-sized block in the message.
const SCREEN_SIZE = ['width', 'height'];
// A box over the whole screen (a backdrop whose press closes a drawer) covers the message instead, so a press outside
// the drawer still lands on it.
// One pinned to all four sides with a size of its own is a centred dialog, not a cover.
const SIDES = ['top', 'right', 'bottom', 'left'];
const OVER_MESSAGE = { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%' };
function covers(style: Declarations) {
  const [width, height] = SCREEN_SIZE.map((property) => style.getPropertyValue(property).trim());
  if (/^100(?:vw|%)$/.test(width!) && /^100(?:vh|%)$/.test(height!)) return true;
  return !width && !height && SIDES.every((side) => /^0(?:px)?$/.test(style.getPropertyValue(side).trim()));
}
// Ruling tripwire (user, 2026-10-18): vw is read against the message's width (Story.module.css), in widths only. A
// font or a gap sized in vw keeps the screen's, as the bot was drawn on Risu's.
const WIDTHS = ['width', 'min-width', 'max-width', 'flex-basis'];
// A number standing alone, not the end of a name (--width-100vw).
const VW = /(?<![\w-])(\d*\.?\d+)vw\b/g;
// A drawer Risu kept off the screen by its own extent (right: -33% beside width: 33%) until a rule set that offset back
// (.panel[class*="opened"] { right: 0 }). Grounded with its offsets gone it would stand open in the message, so it is
// hidden and that rule shows it, across the message: its extent was a share of the screen it slid over. A box only
// partly off the screen (a tab peeking out at right: -23px) stays shown.
const EXTENT = { top: 'height', right: 'width', bottom: 'height', left: 'width' } as const;
type Side = keyof typeof EXTENT;
const LENGTH = /^(-?\d*\.?\d+)([a-z%]*)$/;
type Declarations = Pick<CSSStyleDeclaration, 'getPropertyValue' | 'getPropertyPriority' | 'setProperty' | 'removeProperty'>;
type StyleRule = { selectorText: string; style: Declarations };

function parkedSide(style: Declarations): Side | null {
  for (const side of Object.keys(EXTENT) as Side[]) {
    const offset = LENGTH.exec(style.getPropertyValue(side).trim());
    if (!offset || Number(offset[1]) >= 0) continue;
    const away = -Number(offset[1]);
    const extent = LENGTH.exec(style.getPropertyValue(EXTENT[side]).trim());
    if ((away >= 100 && ['%', 'vw', 'vh'].includes(offset[2]!)) || (extent && extent[2] === offset[2] && away >= Number(extent[1]))) return side;
  }
  return null;
}

const lastCompounds = ({ selectorText }: StyleRule) => selectorText.split(',').map((selector) => /[^\s>+~]+$/.exec(selector.trim())?.[0] ?? '');
const styleRules = (rules: Iterable<object>): StyleRule[] =>
  [...rules].flatMap((rule) => [...('selectorText' in rule && 'style' in rule ? [rule as StyleRule] : []), ...('cssRules' in rule ? styleRules(rule.cssRules as Iterable<object>) : [])]);

// Every value is read before any is changed: a rule that slides a drawer in may itself be fixed, and lose its offset.
export function groundRules(rules: Iterable<object>) {
  const all = styleRules(rules);
  const fixed = all.filter(({ style }) => style.getPropertyValue('position').trim() === 'fixed');
  const parked = fixed.flatMap((rule) => {
    const side = parkedSide(rule.style);
    return side ? [{ rule, side, compounds: lastCompounds(rule).filter(Boolean), display: rule.style.getPropertyValue('display') || 'block' }] : [];
  });
  const shown = all.flatMap((rule) => {
    const drawer = parked.find(({ rule: own, side, compounds }) => {
      const offset = LENGTH.exec(rule.style.getPropertyValue(side).trim());
      return own !== rule && offset && Number(offset[1]) >= 0 && lastCompounds(rule).some((compound) => compounds.some((name) => compound.startsWith(name) && /^(?:$|[[.:#])/.test(compound.slice(name.length))));
    });
    return drawer ? [{ rule, display: drawer.display }] : [];
  });
  // A drawer parked off the screen opens across the message (parked below), not over it.
  const covering = new Set(fixed.filter((rule) => covers(rule.style) && !parked.some((each) => each.rule === rule)));
  for (const rule of fixed) {
    const { style } = rule;
    for (const property of SCREEN_PLACEMENT) style.removeProperty(property);
    if (covering.has(rule)) {
      for (const [property, value] of Object.entries(OVER_MESSAGE)) style.setProperty(property, value);
      continue;
    }
    style.setProperty('position', 'relative');
    for (const property of SCREEN_SIZE) if (/^100v[wh]$/.test(style.getPropertyValue(property).trim())) style.removeProperty(property);
  }
  for (const { rule, side } of parked) {
    rule.style.setProperty('display', 'none');
    rule.style.removeProperty(EXTENT[side]);
  }
  for (const { rule, display } of shown) rule.style.setProperty('display', display);
  for (const { style } of all) {
    for (const property of WIDTHS) {
      const value = style.getPropertyValue(property);
      const read = value.replace(VW, '$1cqw');
      if (read !== value) style.setProperty(property, read, style.getPropertyPriority(property));
    }
  }
}

let base: CSSStyleSheet | null = null;
export const botSheets = (shadow: ShadowRoot) => shadow.adoptedStyleSheets.filter((sheet) => sheet !== base);

const BREAKS = /^(?:P|DIV|LI|TR|BLOCKQUOTE|PRE|H[1-6]|SECTION|ARTICLE|HEADER|FOOTER|UL|OL|TABLE|DETAILS|SUMMARY)$/;
// What a story's html reads as, undrawn (Hazelle.Rendered's text), with a line break for each <br> and block. DOMPurify
// parses it, as sanitize does: the page requires Trusted Types, which a plain DOMParser of a string breaks, and its
// fragment stays in an inert document, so no picture loads.
export function storyText(html: string): string {
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    if (!(node instanceof Element) || node.matches('style, template')) return;
    if (node.tagName === 'BR') text += '\n';
    node.childNodes.forEach(walk);
    if (BREAKS.test(node.tagName)) text += '\n';
  };
  DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }).childNodes.forEach(walk);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const sheets = new Map<string, CSSStyleSheet>();
function sheetFor(css: string, veiled: boolean): CSSStyleSheet {
  const key = `${veiled}:${css}`;
  let sheet = sheets.get(key);
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cleanCss(css, veiled));
    groundRules(sheet.cssRules);
    sheets.set(key, sheet);
    if (sheets.size > 8) sheets.delete(sheets.keys().next().value!);
  }
  return sheet;
}

type Veiled = '이미지' | '영상';

function veilFor(source: string, what: Veiled): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(VEILED, source);
  button.textContent = `${what} 보기`;
  return button;
}

function coverFor(source: string, what: Veiled): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(COVER, source);
  button.setAttribute('aria-label', `${what} 가리기`);
  button.textContent = '가리기';
  return button;
}

const COPIED_MS = 1500;
const COPY_WORDS = { ready: '복사', done: '복사했어요', failed: '복사하지 못했어요' };
function copyButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(COPY, COPY_WORDS.ready);
  button.setAttribute('aria-label', '코드 복사');
  return button;
}

const videoSource = (video: Element) => [video, ...video.querySelectorAll('source')].map((element) => element.getAttribute('src') ?? '').find((source) => OWN_SOURCE.test(source)) ?? null;

// The one mark inlaid left: a paragraph of its own becomes the slot, a mark inside the bot's HTML gives the slot its
// place; a mark the sanitizer took leaves the slot at the end.
function placeInlay(fragment: DocumentFragment, mark: string | null, name: string) {
  const slot = document.createElement('slot');
  slot.name = name;
  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node && mark; node = walker.nextNode() as Text | null) {
    const at = node.data.indexOf(mark);
    if (at === -1) continue;
    const block = node.parentElement;
    if (block?.tagName === 'P' && block.textContent === mark) return block.replaceWith(slot);
    const rest = node.splitText(at);
    rest.data = rest.data.slice(mark.length);
    return rest.before(slot);
  }
  fragment.append(slot);
}

const inlayName = (index: number) => `inlay-${index}`;

function sanitize(html: string, cursor: boolean, veil: Veil | null): DocumentFragment {
  const fragment = DOMPurify.sanitize(setStylesAside(html), CONFIG);
  for (const element of fragment.querySelectorAll<HTMLElement | SVGElement>(`[${SET_ASIDE}]`)) {
    element.style.cssText = cleanCss(element.getAttribute(SET_ASIDE)!, veil !== null);
    groundRules([{ selectorText: '', style: element.style }]);
    element.removeAttribute(SET_ASIDE);
  }
  for (const element of fragment.querySelectorAll('[class]')) element.setAttribute('class', element.getAttribute('class')!.replace(/(^|\s)x-risu-/g, '$1'));
  // Every element that follows a link: HTML's a and area, and SVG's a, whose address may be written as xlink:href.
  // That one is moved to href, which wins when both are written, so one attribute holds every link.
  for (const link of fragment.querySelectorAll('a, area')) {
    const href = link.getAttribute('href') ?? link.getAttributeNS(XLINK, 'href');
    link.removeAttributeNS(XLINK, 'href');
    if (href === null) continue;
    if (!/^https?:/i.test(href)) {
      link.removeAttribute('href');
    } else {
      link.setAttribute('href', href);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  }
  const revealed: { element: Element; source: string; what: Veiled }[] = [];
  // A video is veiled whole: one tapped open keeps the sources inside it.
  const opened = new Set<Element>();
  if (veil) {
    for (const video of fragment.querySelectorAll('video')) {
      const source = videoSource(video);
      if (source === null) continue;
      if (!veil.revealed.has(source)) video.replaceWith(veilFor(source, '영상'));
      else {
        opened.add(video);
        revealed.push({ element: video, source, what: '영상' });
      }
    }
  }
  const inOpened = (element: Element) => {
    const video = element.closest('video');
    return video !== null && opened.has(video);
  };
  for (const element of fragment.querySelectorAll('[src], [srcset]')) {
    const source = element.getAttribute('src') ?? '';
    const own = OWN_SOURCE.test(source);
    if (element.tagName !== 'IMG') {
      if (!own || (veil && !inOpened(element))) element.removeAttribute('src');
    } else if (!own) {
      element.remove();
    } else if (veil && !veil.revealed.has(source)) {
      element.replaceWith(veilFor(source, '이미지'));
    } else if (veil) {
      revealed.push({ element, source, what: '이미지' });
    }
    element.removeAttribute('srcset');
  }
  // Sound starts only from the reader's own press: what would play aloud by itself waits for its
  // controls. A muted one may play; muted is set as the property too, since the attribute is only its default.
  for (const media of fragment.querySelectorAll<HTMLMediaElement>('video[autoplay], audio[autoplay]')) {
    if (media.hasAttribute('muted')) {
      media.muted = true;
    } else {
      media.removeAttribute('autoplay');
      media.controls = true;
    }
  }
  // The other ways HTML draws a picture, none of which a veil opens: SVG's image and feImage, a video's poster, the
  // old background attribute. An SVG href to its own #part is not a picture.
  if (veil) {
    for (const element of fragment.querySelectorAll('[*|href]:not(a, area)')) {
      if (!OWN_SOURCE.test(element.getAttribute('href') ?? element.getAttributeNS(XLINK, 'href') ?? '')) continue;
      element.removeAttribute('href');
      element.removeAttributeNS(XLINK, 'href');
    }
    for (const element of fragment.querySelectorAll('[background], [poster]')) {
      element.removeAttribute('background');
      element.removeAttribute('poster');
    }
  }
  for (const missing of fragment.querySelectorAll(`[${INLAY_MISSING}]`)) missing.textContent = '옮기지 못한 이미지';
  for (const missing of fragment.querySelectorAll(`[${TEXTFILE}]:empty`)) missing.textContent = '찾을 수 없는 파일';
  const texts = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode() as Text | null; node; node = texts.nextNode() as Text | null) {
    if (!node.data.includes(ORIGINAL_MARK)) continue;
    node.data = node.data.replaceAll(ORIGINAL_MARK, '');
    node.parentElement?.closest(ORIGINAL_BLOCK)?.setAttribute(ORIGINAL, '');
  }
  for (const [index, block] of [...fragment.children].entries()) {
    const only = block.childElementCount === 1 && block.firstElementChild!.tagName === 'IMG' && !block.textContent!.trim();
    if (only && block.matches('p, .risu-inlay-image')) block.setAttribute(PICTURE, String(index));
  }
  if (cursor) {
    const last = (node: ParentNode) => {
      let child = node.lastChild;
      while (child instanceof Text && !child.data.trim()) child = child.previousSibling;
      return child;
    };
    let at: ParentNode = fragment;
    // Not into SVG or MathML, where an HTML slot draws nothing.
    for (let child = last(at); child instanceof Element && child.namespaceURI === HTML && !VOID.has(child.tagName); child = last(at)) at = child;
    if (at === fragment) at = fragment.appendChild(document.createElement('p'));
    const slot = document.createElement('slot');
    slot.name = 'cursor';
    at.append(slot);
  }
  // Last: a control inside a picture's line would cost it its data-picture, and the cursor would go into the control.
  for (const { element, source, what } of revealed) element.after(coverFor(source, what));
  for (const pre of fragment.querySelectorAll('pre')) if (pre.querySelector(':scope > code')) pre.append(copyButton());
  return fragment;
}

const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div';

// What is selected in a story: the selected text of its first block and, when it runs on, of its last, and where it
// ends; null when the selection begins or ends outside it. By block, since a range's text runs blocks together.
export function storySelection(story: HTMLElement): { pieces: string[]; end: SelectionEnd } | null {
  const root = story.firstElementChild?.shadowRoot;
  const selection = document.getSelection();
  if (!root || !selection || !('getComposedRanges' in selection)) return null;
  const [range] = selection.getComposedRanges({ shadowRoots: [root] });
  if (!range || range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const block = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest(BLOCK) ?? root;
  const text = (start: Node, startOffset: number, end: Node, endOffset: number) => {
    const part = document.createRange();
    part.setStart(start, startOffset);
    part.setEnd(end, endOffset);
    return part.toString();
  };
  const whole = document.createRange();
  whole.setStart(range.startContainer, range.startOffset);
  whole.setEnd(range.endContainer, range.endOffset);
  const line = [...whole.getClientRects()].at(-1) ?? whole.getBoundingClientRect();
  const end = { x: line.right, top: line.top, bottom: line.bottom };
  const [first, last] = [block(range.startContainer), block(range.endContainer)];
  if (first === last) return { pieces: [whole.toString()], end };
  return { pieces: [text(range.startContainer, range.startOffset, first, first.childNodes.length), text(last, 0, range.endContainer, range.endOffset)], end };
}

// A picture removed before it loaded has no line left to mark.
const mark = (picture: HTMLImageElement) => picture.parentElement?.toggleAttribute(WIDE, picture.naturalWidth > picture.naturalHeight);
const markLoaded = (event: Event) => mark(event.target as HTMLImageElement);
// The build writes a token's 250ms as .25s.
const milliseconds = (time: string) => parseFloat(time) * (time.trim().endsWith('ms') ? 1 : 1000);
// A picture's line easing open or shut (Story's reshape), so a turn midway takes over from it.
const running = new WeakMap<Element, Animation>();

// Set over any the bot's HTML wrote. A picture already loaded is measured before the frame is drawn. One shared
// listener, since a kept picture is marked again on every draw and the same listener added twice is added once.
function markWide(picture: HTMLImageElement) {
  if (picture.complete) mark(picture);
  else picture.addEventListener('load', markLoaded, { once: true });
}

// Brings live to want's shape in place, keeping every node both hold, so a picture, video or animation drawn before a
// streamed chunk goes on through it. By position, since a reply grows at its end. want's new nodes are moved, not copied.
function morph(live: ParentNode, want: ParentNode) {
  let at = live.firstChild;
  for (const node of [...want.childNodes]) {
    if (!at) {
      live.append(node);
      continue;
    }
    const next = at.nextSibling;
    if (!at.isEqualNode(node)) fit(at, node);
    at = next;
  }
  while (at) {
    const next = at.nextSibling;
    at.remove();
    at = next;
  }
}

const isStyle = (namespaceURI: string | null, localName: string) => namespaceURI === null && localName === 'style';

function fit(at: ChildNode, node: ChildNode) {
  if (at instanceof Element && node instanceof Element && at.namespaceURI === node.namespaceURI && at.localName === node.localName) {
    for (const { namespaceURI, localName } of [...at.attributes]) if (!isStyle(namespaceURI, localName) && !node.hasAttributeNS(namespaceURI, localName)) at.removeAttributeNS(namespaceURI, localName);
    for (const { namespaceURI, localName, name, value } of node.attributes) if (!isStyle(namespaceURI, localName) && at.getAttributeNS(namespaceURI, localName) !== value) at.setAttributeNS(namespaceURI, name, value);
    // Through CSSOM, as the draw applies it: a style attribute set by script changes the attribute and, under the CSP,
    // not the declarations, so a backdrop that gained its picture kept drawing none.
    const style = (at as HTMLElement).style;
    if (style.cssText !== (node as HTMLElement).style.cssText) style.cssText = (node as HTMLElement).style.cssText;
    morph(at, node);
  } else if (at instanceof CharacterData && at.nodeType === node.nodeType) {
    at.data = (node as CharacterData).data;
  } else {
    at.replaceWith(node);
  }
}

// Given by a box sized by its story's words (StoryMessage's bubble), named in Story.shadow.css.
export const FitsWordsContext = createContext(false);

// A message's text, drawn in a shadow root so a bot's HTML and CSS can never restyle or cover the app.
export function Story({ html, css = '', cursor = false, tone = 'plain', buttons = 'inert', onPress, term = '', whole = false, inlays = [], illustrations = [], ref }: Props) {
  const room = useMarginRoom();
  const beside = illustrations.length > 0 && room;
  // Beside, each picture's slot stands empty where its mark is, which MarginPictures levels the picture with.
  const anchors = useRef<(HTMLElement | null)[]>([]);
  const slotted = [...illustrations, ...inlays];
  const pictures = useRowState(PICTURES, () => new Set<string>());
  // The picture the pointer holds open, kept over a draw as a tapped one is.
  const hovered = useRef<string | null>(null);
  const veil = useVeil();
  const quotes = useQuoteShape();
  const fits = useContext(FitsWordsContext);
  // A veil tapped open or shut changes only veil.revealed, which no render sees.
  const [veilTaps, tapVeil] = useReducer((count: number) => count + 1, 0);
  const host = useRef<HTMLDivElement>(null);
  const root = () => host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' });

  const marks = slotted.map(({ mark }) => mark);
  // A dependency that changes only when a mark does.
  const placed = JSON.stringify(marks);
  const math = useMath(html);
  const code = useCode(html);
  useLayoutEffect(() => {
    const marked = marks.reduce((text: string, mark) => (mark ? inlaid(text, mark, mark) : text), html);
    const fragment = sanitize([math, code].reduce((text, draw) => (draw ? draw(text) : text), marked), cursor, veil);
    for (const picture of fragment.querySelectorAll(`[${PICTURE}]`)) {
      if (whole || pictures?.has(pictureKey(picture))) picture.setAttribute(OPEN, '');
      else if (pictureKey(picture) === hovered.current) picture.setAttribute(HOVER, '');
    }
    // After the cursor, which would otherwise go into the slot.
    for (const [index, mark] of marks.entries()) placeInlay(fragment, mark, inlayName(index));
    morph(root(), fragment);
    for (const picture of root().querySelectorAll<HTMLImageElement>(`[${PICTURE}] > img`)) markWide(picture);
  }, [html, cursor, pictures, veil, veilTaps, whole, placed, math, code]);

  // After the text is drawn, so the ranges lie over the nodes it now holds. Without the API, nothing is lit.
  useEffect(() => {
    if (!term || !('highlights' in CSS)) return;
    if (!foundTerm) CSS.highlights.set(FOUND_TERM, (foundTerm = new Highlight()));
    const lit = foundTerm;
    const ranges = termRanges(root(), term);
    for (const range of ranges) lit.add(range);
    return () => {
      for (const range of ranges) lit.delete(range);
    };
  }, [html, cursor, pictures, veil, veilTaps, term, placed, math, code]);

  useLayoutEffect(() => {
    if (!base) (base = new CSSStyleSheet()).replaceSync(shadowCss);
    root().adoptedStyleSheets = css ? [base, sheetFor(css, veil !== null)] : [base];
  }, [css, veil]);

  useEffect(() => {
    const shadow = root();
    // Its height eased from where it is drawn to where change leaves it. From the drawn height, so a line turned again
    // midway goes on from there; content heights, as max-height reads them whatever the bot's box-sizing.
    const reshape = (line: HTMLElement, change: () => void) => {
      const height = () => getComputedStyle(line).height;
      const from = height();
      running.get(line)?.cancel();
      change();
      const to = height();
      if (from === to) return;
      const tokens = getComputedStyle(host.current!);
      const duration = tokens.getPropertyValue(matchMedia('(prefers-reduced-motion: reduce)').matches ? '--duration-instant' : '--duration-slow');
      const animation = line.animate({ maxHeight: [from, to] }, { duration: milliseconds(duration), easing: tokens.getPropertyValue('--ease-enter') });
      running.set(line, animation);
      host.current!.dispatchEvent(new Event(READER_RESIZED, { bubbles: true }));
    };
    // Unpinned by a tap while the pointer is still over it: it stays shut until the pointer leaves.
    const resting = new WeakSet<Element>();
    const clipped = (line: Element) => line.scrollHeight > line.clientHeight;
    // Only a pointer moved over it: a picture the story scrolls under a still pointer opens nothing.
    const enter = (event: Event) => {
      const { pointerType, movementX, movementY } = event as PointerEvent;
      if (pointerType !== 'mouse' || (!movementX && !movementY)) return;
      const line = (event.target as Element).closest<HTMLElement>(`[${PICTURE}]`);
      if (!line || line.hasAttribute(OPEN) || line.hasAttribute(HOVER) || resting.has(line) || !clipped(line)) return;
      hovered.current = pictureKey(line);
      reshape(line, () => line.setAttribute(HOVER, ''));
    };
    const leave = (event: Event) => {
      const line = (event.target as Element).closest<HTMLElement>(`[${PICTURE}]`);
      if (!line || line.contains((event as PointerEvent).relatedTarget as Node | null)) return;
      resting.delete(line);
      if (!line.hasAttribute(HOVER)) return;
      hovered.current = null;
      reshape(line, () => line.removeAttribute(HOVER));
    };
    const press = (event: Event) => {
      // The inlay's own controls are the app's, slotted in from outside the root, and never a bot's button.
      if (!shadow.contains(event.target as Node)) return;
      const copy = (event.target as Element).closest<HTMLElement>(`[${COPY}]`);
      if (copy) {
        event.preventDefault();
        const said = (words: string) => {
          copy.setAttribute(COPY, words);
          setTimeout(() => copy.setAttribute(COPY, COPY_WORDS.ready), COPIED_MS);
        };
        navigator.clipboard.writeText(copy.parentElement!.querySelector(':scope > code')!.textContent!).then(() => said(COPY_WORDS.done), () => said(COPY_WORDS.failed));
        return;
      }
      const veiled = (event.target as Element).closest(`[${VEILED}]`);
      if (veiled && veil) {
        veil.revealed.add(veiled.getAttribute(VEILED)!);
        tapVeil();
        event.preventDefault();
        return;
      }
      // Before the picture's line, which holds it and would fold instead.
      const cover = (event.target as Element).closest(`[${COVER}]`);
      if (cover && veil) {
        veil.revealed.delete(cover.getAttribute(COVER)!);
        tapVeil();
        event.preventDefault();
        return;
      }
      const picture = (event.target as Element).closest<HTMLElement>(`[${PICTURE}]`);
      // A short picture, or one its character shows whole, has nothing to open, and a tap on it is the message's.
      if (picture && (picture.hasAttribute(OPEN) || picture.hasAttribute(HOVER) || clipped(picture))) {
        const pin = !picture.hasAttribute(OPEN);
        const source = pictureKey(picture);
        if (hovered.current === source) hovered.current = null;
        reshape(picture, () => {
          picture.toggleAttribute(OPEN, pin);
          picture.removeAttribute(HOVER);
        });
        if (pin) pictures?.add(source);
        else {
          pictures?.delete(source);
          resting.add(picture);
        }
        event.preventDefault();
        return;
      }
      // The nearest element that names what to run: a plain button inside one is that one's press.
      const named = (event.target as Element).closest(NAMED);
      if (!named && !(event.target as Element).closest('button')) return;
      event.preventDefault();
      // An element with both is its trigger, as in Risu.
      const trigger = named?.getAttribute('risu-trigger') ?? null;
      onPress?.(trigger !== null ? { trigger, id: named!.getAttribute('risu-id') ?? '' } : named ? { data: named.getAttribute('risu-btn')! } : null);
    };
    shadow.addEventListener('click', press);
    shadow.addEventListener('pointermove', enter);
    shadow.addEventListener('pointerout', leave);
    return () => {
      shadow.removeEventListener('click', press);
      shadow.removeEventListener('pointermove', enter);
      shadow.removeEventListener('pointerout', leave);
    };
  }, [onPress, pictures, veil]);

  // The stage is laid out against the message, outside the story's containment, which would clip it.
  return (
    <>
      <div ref={ref} className={tone === 'faded' ? `${styles.story} ${styles.faded}` : styles.story}>
        <div ref={host} data-buttons={buttons} data-quotes={quotes} data-fits={fits || undefined} data-scrollbars={scrollbarKind()}>
          {cursor && <span slot="cursor" className={styles.cursor} aria-hidden />}
          {slotted.map(({ node }, index) =>
            beside && index < illustrations.length ? (
              <div
                key={index}
                slot={inlayName(index)}
                ref={(element) => {
                  anchors.current[index] = element;
                }}
              />
            ) : (
              <div key={index} slot={inlayName(index)}>
                {node}
              </div>
            ),
          )}
        </div>
      </div>
      {beside && (
        <MarginPictures anchors={anchors} side={beside}>
          {illustrations.map(({ node }) => node)}
        </MarginPictures>
      )}
    </>
  );
}
