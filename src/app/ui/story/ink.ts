import { MEDIA, mediaQuery } from '../foundation/media';
import { tokenMs } from '../foundation/tokenPx';

// How a reply being written comes into view: an ink edge runs after the text at an even speed, what it has not reached
// is unseen, and from the edge back to the solid mark the characters go from clear to solid. The solid mark trails the
// edge by WIDTH characters and closes on it once nothing more comes. Both marks only move forward, so a character only
// ever gets more solid. Counted in characters of the story's text nodes, in document order.
export type Ink = { length: number; edge: number; solid: number; speed: number; grew: number };
// In ms. follow: how long the edge takes to close on the text; even: over how long its speed changes; idle: how long
// after the last growth the solid mark starts to close; close: how long it takes to close a whole WIDTH.
export type Pace = { follow: number; even: number; idle: number; close: number };

export const WIDTH = 40;
const STEPS = 32;
// Characters a ms: a few characters short of the end still arrive.
const SLOWEST = 0.02;
// A frame after a sleeping tab counts as this long.
const LONGEST = 50;

// At the length the story has when its writing begins, so what stood before is solid: a continuation's earlier text, a
// reply met midway.
export const startInk = (length: number, now: number): Ink => ({ length, edge: length, solid: length, speed: 0, grew: now });

export const settled = ({ length, edge, solid }: Ink) => edge >= length && solid >= edge;

export function drawnInk(ink: Ink, length: number, now: number): Ink {
  const edge = Math.min(ink.edge, length);
  return { ...ink, length, edge, solid: Math.min(ink.solid, edge), grew: length > ink.length ? now : ink.grew };
}

export function stepInk(ink: Ink, since: number, now: number, pace: Pace): Ink {
  // A frame is stamped when it began, which on a busy page is before its run was asked for: no time has passed then.
  const passed = Math.max(0, Math.min(LONGEST, since));
  const speed = Math.max(SLOWEST, ink.speed + ((ink.length - ink.edge) / pace.follow - ink.speed) * (1 - Math.exp(-passed / pace.even)));
  const edge = Math.min(ink.length, ink.edge + speed * passed);
  const closing = now - ink.grew < pace.idle ? 0 : Math.min(edge, ink.solid + (WIDTH / pace.close) * passed);
  return { ...ink, speed, edge, solid: Math.max(ink.solid, edge - WIDTH, closing) };
}

// The ranges are the CSS Custom Highlight API's: the story's nodes are never touched, so the story's morph meets the
// DOM it left. A highlight is shared by every story by its name, so each story adds and takes back its own ranges.
const UNSEEN = 'ink-unseen';
const highlights = new Map<string, Highlight>();
function highlight(name: string) {
  let made = highlights.get(name);
  if (!made) {
    highlights.set(name, (made = new Highlight()));
    CSS.highlights.set(name, made);
  }
  return made;
}

// currentColor in a highlight is not the words' own colour (Chromium 153 paints black), so each colour met in a
// gradient gets its steps written out. Started again when a bot's colours have filled it; the next frame names anew.
const PALETTE = 48;
let palette: string[] = [];
let paletteSheet: CSSStyleSheet | undefined;
export function inkSheet() {
  return (paletteSheet ??= new CSSStyleSheet());
}
function colourNumber(colour: string) {
  let at = palette.indexOf(colour);
  if (at >= 0) return at;
  if (palette.length === PALETTE) palette = [];
  at = palette.push(colour) - 1;
  inkSheet().replaceSync(palette.map((each, number) => Array.from({ length: STEPS }, (_, step) => '::highlight(ink-' + number + '-' + step + '){color:color-mix(in srgb,' + each + ' ' + (((step + 0.5) / STEPS) * 100).toFixed(1) + '%,transparent)}').join('')).join(''));
  return at;
}

// Without the API, or where motion is to be reduced, a reply is written as it was: whole to its cursor.
export const inkable = () => 'highlights' in CSS && !mediaQuery(MEDIA.reducedMotion).read();

type Piece = { node: Text; start: number };
function textOf(shadow: ShadowRoot) {
  const walker = document.createTreeWalker(shadow, NodeFilter.SHOW_TEXT);
  const pieces: Piece[] = [];
  let text = '';
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.parentElement?.localName === 'style') continue;
    pieces.push({ node, start: text.length });
    text += node.data;
  }
  return { pieces, text };
}

// What Story.shadow.css and Story.module.css read on the host: behind while some text is unseen, level otherwise.
const INK = 'data-ink';

export type StoryInk = { drawn: (writing: boolean) => void; end: () => void; gate: CSSStyleSheet };

// One story's ink. fresh: the story is first drawn while written, so all of it comes in by ink; otherwise what
// stood before the writing began (a continuation's earlier text) is solid. drawn: told after every draw, in the draw's own task, since a text node given new data collapses
// the ranges in it and the unseen would show for a frame. gate: holds back the blocks past the one the edge is in,
// their pictures, bullets and boxes with them, which no highlight reaches.
export function inkOn(host: HTMLElement, shadow: ShadowRoot, fresh: boolean): StoryInk {
  const pace: Pace = { follow: tokenMs('--duration-ink-follow', host), even: tokenMs('--duration-ink-even', host), idle: tokenMs('--duration-ink-idle', host), close: tokenMs('--duration-ink-close', host) };
  const gate = new CSSStyleSheet();
  shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, gate];
  let ink: Ink | null = fresh ? startInk(0, performance.now()) : null;
  let pieces: Piece[] = [];
  let text = '';
  let own: [Highlight, Range][] = [];
  let gated: number | null = null;
  let frame = 0;
  let last = 0;
  let writing = false;
  let lost = false;
  // Where the ranges last laid begin and end: a frame that moves none of them lays nothing.
  let laid: string | null = null;

  const clear = () => {
    for (const [made, range] of own) made.delete(range);
    own = [];
  };
  const pieceAt = (offset: number) => pieces.findLastIndex(({ start }) => start <= offset);
  const add = (name: string, node: Text, from: number, endNode: Text, to: number) => {
    const range = new Range();
    range.setStart(node, from);
    range.setEnd(endNode, to);
    const made = highlight(name);
    made.add(range);
    own.push([made, range]);
  };
  // from: the first of the root's elements held back, counted from 1; null for none.
  const gateAt = (from: number | null) => {
    if (from === gated) return;
    gated = from;
    gate.replaceSync(from === null ? '' : ':host > :nth-child(n+' + from + '){opacity:0;transition:none}');
  };
  const lay = () => {
    clear();
    if (!ink || settled(ink)) {
      gateAt(null);
      return;
    }
    const length = text.length;
    const edge = Math.round(ink.edge);
    const colours = new Map<Element, string>();
    if (edge < length) {
      const first = pieces[pieceAt(edge)]!;
      const end = pieces.at(-1)!;
      add(UNSEEN, first.node, edge - first.start, end.node, end.node.data.length);
    }
    const step = (ink.edge - ink.solid) / STEPS;
    for (let at = 0; at < STEPS; at++) {
      const [from, to] = [Math.max(0, Math.round(ink.edge - (at + 1) * step)), Math.min(length, Math.round(ink.edge - at * step))];
      for (let index = from < to ? pieceAt(from) : pieces.length; index < pieces.length && pieces[index]!.start < to; index++) {
        const { node, start } = pieces[index]!;
        const [first, second] = [Math.max(0, from - start), Math.min(node.data.length, to - start)];
        const parent = node.parentElement;
        if (first >= second || !parent) continue;
        let colour = colours.get(parent);
        if (!colour) colours.set(parent, (colour = getComputedStyle(parent).color));
        add('ink-' + colourNumber(colour) + '-' + at, node, first, node, second);
      }
    }
    // The block of the last character the edge has passed, or the one before the line break between two blocks,
    // which is a text node of the root; the blocks after it wait.
    if (edge >= length) return gateAt(null);
    if (edge === 0) return gateAt(1);
    let block: Node = pieces[pieceAt(edge - 1)]!.node;
    while (block.parentNode !== shadow) block = block.parentNode!;
    const reached = block instanceof Element ? block : (block as Text).previousElementSibling;
    gateAt(reached ? [...shadow.children].indexOf(reached) + 2 : 1);
  };
  const mark = () => {
    if (!ink || (settled(ink) && !writing)) host.removeAttribute(INK);
    else host.setAttribute(INK, Math.round(ink.edge) < ink.length ? 'behind' : 'level');
  };
  const rest = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    clear();
  };
  // The story's nodes are not the ink's alone: a browser's translation or an extension cuts and moves text between
  // two draws, and a range then names an offset or a node that is gone. The ink ends for this story, its text stands
  // whole, and the error is told as one nobody caught: thrown on, it would take the screen down from a draw.
  const laying = () => {
    try {
      lay();
      return true;
    } catch (error) {
      lost = true;
      ink = null;
      rest();
      gateAt(null);
      mark();
      reportError(error);
      return false;
    }
  };
  const run = () => {
    if (frame || !ink || settled(ink)) return;
    last = performance.now();
    frame = requestAnimationFrame(function tick(now) {
      ink = stepInk(ink!, now - last, now, pace);
      last = now;
      const next = settled(ink) ? '' : Array.from({ length: STEPS + 1 }, (_, at) => Math.round(ink!.edge - (at * (ink!.edge - ink!.solid)) / STEPS)).join();
      if (next !== laid && !laying()) return;
      laid = next;
      mark();
      frame = settled(ink) ? 0 : requestAnimationFrame(tick);
    });
  };

  return {
    gate,
    drawn(now) {
      if (lost) return;
      writing = now;
      // Settled and no longer written: nothing to read until the writing begins again.
      if (!writing && (!ink || settled(ink))) {
        ink = null;
        // A frame asked for while it was unsettled may still wait: a text rewritten whole settles it between frames.
        rest();
        gateAt(null);
        return mark();
      }
      const before = text;
      ({ pieces, text } = textOf(shadow));
      const at = performance.now();
      // What the edge has passed reads as it did: the text only grew past it. Anything else is not a reply being
      // written on (a script rewrote it, a translation took its place), and stands whole at once.
      ink = ink && text.startsWith(before.slice(0, Math.round(ink.edge))) ? drawnInk(ink, text.length, at) : startInk(text.length, at);
      if (!laying()) return;
      laid = null;
      mark();
      run();
    },
    end: rest,
  };
}
