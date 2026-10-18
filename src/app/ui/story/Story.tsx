import DOMPurify from 'dompurify';
import { useEffect, useLayoutEffect, useReducer, useRef, type ReactNode, type Ref } from 'react';
import { useRowState } from '../collections/row-memory';
import { scrollbarKind } from '../foundation/scrollbar';
import { useQuoteShape } from '../foundation/quotes';
import { useVeil, type Veil } from '../foundation/veil';
import { inlaid } from './inlay';
import type { SelectionEnd } from './SelectionButton';
import { useMath } from './math';
import styles from './Story.module.css';
import shadowCss from './Story.shadow.css?inline';

// One of the bot's buttons, as its HTML names it: risu-trigger names a function of its script, risu-btn carries data to it.
// id: the trigger's element's risu-id, which {{triggerid}} reads; '' when it has none.
export type BotButton = { trigger: string; id: string } | { data: string };

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
  // The message's 삽화, each put where its mark stands in html (inlaid), or at the end for a mark null.
  inlays?: { mark: string | null; node: ReactNode }[];
  // The element storySelection reads.
  ref?: Ref<HTMLDivElement>;
};

const NAMED = '[risu-trigger], [risu-btn]';
// Named in Story.shadow.css.
const PICTURE = 'data-picture';
const OPEN = 'data-open';
// Named in Story.shadow.css: on a picture's line whose picture is wider than tall, which CSS cannot tell.
const WIDE = 'data-wide';
const PICTURES = Symbol('pictures');
// Named in Story.shadow.css. Holds the source of the picture or video it stands in for.
const VEILED = 'data-veiled';
// Named in Story.shadow.css. Holds the source of the picture or video tapped open that it covers again.
const COVER = 'data-cover';
// Named in Story.shadow.css and in engine/assets.ts (inlayMissing), whose mark stands where a chat's inlay is missing.
const INLAY_MISSING = 'data-inlay-missing';
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
// A drawer Risu kept off the screen by its own extent (right: -33% beside width: 33%) until a rule set that offset back
// (.panel[class*="opened"] { right: 0 }). Grounded with its offsets gone it would stand open in the message, so it is
// hidden and that rule shows it, across the message: its extent was a share of the screen it slid over. A box only
// partly off the screen (a tab peeking out at right: -23px) stays shown.
const EXTENT = { top: 'height', right: 'width', bottom: 'height', left: 'width' } as const;
type Side = keyof typeof EXTENT;
const LENGTH = /^(-?\d*\.?\d+)([a-z%]*)$/;
type Declarations = Pick<CSSStyleDeclaration, 'getPropertyValue' | 'setProperty' | 'removeProperty'>;
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
  for (const { style } of fixed) {
    style.setProperty('position', 'relative');
    for (const property of SCREEN_PLACEMENT) style.removeProperty(property);
    for (const property of SCREEN_SIZE) if (/^100v[wh]$/.test(style.getPropertyValue(property).trim())) style.removeProperty(property);
  }
  for (const { rule, side } of parked) {
    rule.style.setProperty('display', 'none');
    rule.style.removeProperty(EXTENT[side]);
  }
  for (const { rule, display } of shown) rule.style.setProperty('display', display);
}

let base: CSSStyleSheet | null = null;
export const botSheets = (shadow: ShadowRoot) => shadow.adoptedStyleSheets.filter((sheet) => sheet !== base);
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

// Set over any the bot's HTML wrote. A picture already loaded is measured before the frame is drawn.
function markWide(picture: HTMLImageElement) {
  const mark = () => picture.parentElement!.toggleAttribute(WIDE, picture.naturalWidth > picture.naturalHeight);
  if (picture.complete) mark();
  else picture.addEventListener('load', mark, { once: true });
}

// A message's text, drawn in a shadow root so a bot's HTML and CSS can never restyle or cover the app.
export function Story({ html, css = '', cursor = false, tone = 'plain', buttons = 'inert', onPress, term = '', whole = false, inlays = [], ref }: Props) {
  const pictures = useRowState(PICTURES, () => new Set<string>());
  const veil = useVeil();
  const quotes = useQuoteShape();
  // A veil tapped open or shut changes only veil.revealed, which no render sees.
  const [veilTaps, tapVeil] = useReducer((count: number) => count + 1, 0);
  const host = useRef<HTMLDivElement>(null);
  const root = () => host.current!.shadowRoot ?? host.current!.attachShadow({ mode: 'open' });

  const marks = inlays.map(({ mark }) => mark);
  // A dependency that changes only when a mark does.
  const placed = JSON.stringify(marks);
  const math = useMath(html);
  useLayoutEffect(() => {
    const marked = marks.reduce((text: string, mark) => (mark ? inlaid(text, mark, mark) : text), html);
    const fragment = sanitize(math ? math(marked) : marked, cursor, veil);
    for (const picture of fragment.querySelectorAll(`[${PICTURE}]`)) {
      if (whole || pictures?.has(pictureKey(picture))) picture.setAttribute(OPEN, '');
    }
    // After the cursor, which would otherwise go into the slot.
    for (const [index, mark] of marks.entries()) placeInlay(fragment, mark, inlayName(index));
    root().replaceChildren(fragment);
    for (const picture of root().querySelectorAll<HTMLImageElement>(`[${PICTURE}] > img`)) markWide(picture);
  }, [html, cursor, pictures, veil, veilTaps, whole, placed, math]);

  // After the text is drawn, which drops every range made over the text before. Without the API, nothing is lit.
  useEffect(() => {
    if (!term || !('highlights' in CSS)) return;
    if (!foundTerm) CSS.highlights.set(FOUND_TERM, (foundTerm = new Highlight()));
    const lit = foundTerm;
    const ranges = termRanges(root(), term);
    for (const range of ranges) lit.add(range);
    return () => {
      for (const range of ranges) lit.delete(range);
    };
  }, [html, cursor, pictures, veil, veilTaps, term, placed, math]);

  useLayoutEffect(() => {
    if (!base) (base = new CSSStyleSheet()).replaceSync(shadowCss);
    root().adoptedStyleSheets = css ? [base, sheetFor(css, veil !== null)] : [base];
  }, [css, veil]);

  useEffect(() => {
    const shadow = root();
    const press = (event: Event) => {
      // The inlay's own controls are the app's, slotted in from outside the root, and never a bot's button.
      if (!shadow.contains(event.target as Node)) return;
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
      const picture = (event.target as Element).closest(`[${PICTURE}]`);
      // A short picture, or one its character shows whole, has nothing to open, and a tap on it is the message's.
      if (picture && (picture.hasAttribute(OPEN) || picture.scrollHeight > picture.clientHeight)) {
        const opened = picture.toggleAttribute(OPEN);
        const source = pictureKey(picture);
        if (opened) pictures?.add(source);
        else pictures?.delete(source);
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
    // transitionend, not transitionstart: it lands in the frame of the new size, before that frame's resize observers.
    const resized = (event: Event) => {
      if ((event as TransitionEvent).propertyName !== 'max-height' || !(event.target as Element).hasAttribute(PICTURE)) return;
      host.current!.dispatchEvent(new Event(READER_RESIZED, { bubbles: true }));
    };
    shadow.addEventListener('click', press);
    shadow.addEventListener('transitionend', resized);
    return () => {
      shadow.removeEventListener('click', press);
      shadow.removeEventListener('transitionend', resized);
    };
  }, [onPress, pictures, veil]);

  return (
    <div ref={ref} className={tone === 'faded' ? `${styles.story} ${styles.faded}` : styles.story}>
      <div ref={host} data-buttons={buttons} data-quotes={quotes} data-scrollbars={scrollbarKind()}>
        {cursor && <span slot="cursor" className={styles.cursor} aria-hidden />}
        {inlays.map(({ node }, index) => (
          <div key={index} slot={inlayName(index)}>
            {node}
          </div>
        ))}
      </div>
    </div>
  );
}
