import { createContext, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import styles from './NightScene.module.css';
import { about, ANYWHERE, painterOn, parseColor, parseFade, parseGradients, parseShadows, roundGlow, scaling, share, shift, skewingX, times, turning, type Affine, type Box, type Fade, type Gradient } from './paint';
import { scrollRange, type Pace } from './walkStops';

type Screen = { w: number; h: number };
// Where the walk has a layer at a tuned share of the scroll: x and y in CSS pixels, scale about its transform-origin.
export type Walked = { scale?: number; x?: number; y?: number; opacity?: number };
export type Walk = (share: number, screen: Screen) => Walked;
// near: how much looking around moves it. carried: it goes where the visitor's lantern is.
export type Layer = { walk?: Walk; near?: number; carried?: boolean };

const Layers = createContext<{ layers: Map<HTMLElement, Layer>; changed: () => void }>({ layers: new Map(), changed: () => {} });
export const LayersOfScene = Layers.Provider;

// A node of the scene the canvas paints, with everything inside it, as its CSS lays it out.
export function useLayer(layer: Layer) {
  const node = useRef<HTMLDivElement>(null);
  const { layers, changed } = useContext(Layers);
  useLayoutEffect(() => {
    const element = node.current!;
    layers.set(element, layer);
    changed();
    return () => {
      layers.delete(element);
      changed();
    };
  }, []);
  return node;
}

// The pictures are painted at most this many pixels to a CSS pixel: none of them holds more than about two at a phone's size.
const DENSITY = 1.5;
// Between frames when only the breeze, the flames and the fireflies move.
const AMBIENT_GAP = 33;
// Looking around moves a layer less up and down than across.
const LOOK_RISE = 0.4;

type Piece = {
  key: Element | null;
  box: Box;
  clip: Box;
  paint: { kind: 'picture'; img: HTMLImageElement; cover: readonly [number, number] | null; fade: Fade | undefined; tiled: boolean } | { kind: 'gradient'; gradient: Gradient };
  flicker: { takes: number; flare: number } | null;
  fly: { takes: number; after: number } | null;
};
type Loops = Pick<Piece, 'flicker' | 'fly'>;
type Motion = { origin: readonly [number, number]; takes: number; from: number; to: number; turns: boolean };
type Planned = { root: HTMLElement; layer: Layer; origin: readonly [number, number]; opacity: number; motion: Motion | null; pieces: Piece[] };
type Tween = { x: number; y: number; opacity: number; began: number };

const seconds = (text: string) => parseFloat(text) / (text.trim().endsWith('ms') ? 1000 : 1);

const BEZIERS: Record<string, readonly number[]> = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
// A CSS easing keyword or cubic-bezier(), as a function of progress.
const easing = (text: string) => {
  const [x1, y1, x2, y2] = BEZIERS[text.trim()] ?? /cubic-bezier\(([^)]*)\)/.exec(text)?.[1]?.split(',').map(Number) ?? BEZIERS['ease']!;
  const curve = (at: number, one: number, two: number) => 3 * (1 - at) ** 2 * at * one + 3 * (1 - at) * at * at * two + at ** 3;
  return (progress: number) => {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 16; step++) {
      const at = (low + high) / 2;
      if (curve(at, x1!, x2!) < progress) low = at;
      else high = at;
    }
    return curve((low + high) / 2, y1!, y2!);
  };
};

const within = (node: Element, frame: DOMRect): Box => {
  const { left, top, width, height } = node.getBoundingClientRect();
  return { x: left - frame.left, y: top - frame.top, w: width, h: height };
};
const originOf = (node: Element, box: Box) => {
  const [x, y] = getComputedStyle(node).transformOrigin.split(' ').map(parseFloat);
  return [box.x + x!, box.y + y!] as const;
};
const meet = (one: Box, other: Box): Box => {
  const x = Math.max(one.x, other.x);
  const y = Math.max(one.y, other.y);
  return { x, y, w: Math.max(Math.min(one.x + one.w, other.x + other.w) - x, 0), h: Math.max(Math.min(one.y + one.h, other.y + other.h) - y, 0) };
};

const tiles = new Map<string, HTMLImageElement>();
const tileOf = (source: string, loaded: () => void) => {
  let tile = tiles.get(source);
  if (!tile) {
    tile = new Image();
    tile.addEventListener('load', loaded, { once: true });
    tile.src = source;
    tiles.set(source, tile);
  }
  return tile;
};

const NO_LOOPS: Loops = { flicker: null, fly: null };

// The scene's CSS lays every piece out and colors it; the canvas moves it and paints what it says.
function piecesOf(root: HTMLElement, frame: DOMRect, loaded: () => void) {
  const pieces: Piece[] = [];
  const background = (key: Element | null, style: CSSStyleDeclaration, box: Box, clip: Box, loops: Loops) => {
    const core = parseColor(style.backgroundColor);
    const shadows = parseShadows(style.boxShadow);
    if (core && shadows.length && parseFloat(style.borderTopLeftRadius) >= box.w / 2) {
      const { reach, gradient } = roundGlow(core, box.w / 2, shadows);
      pieces.push({ key, box: { x: box.x + box.w / 2 - reach, y: box.y + box.h / 2 - reach, w: reach * 2, h: reach * 2 }, clip, paint: { kind: 'gradient', gradient }, ...loops });
      return;
    }
    if (core?.[3]) pieces.push({ key, box, clip, paint: { kind: 'gradient', gradient: { kind: 'linear', stops: [{ at: 0, color: core }] } }, ...loops });
    for (const gradient of parseGradients(style.backgroundImage)) pieces.push({ key, box, clip, paint: { kind: 'gradient', gradient }, ...loops });
    const tiled = /url\("?([^")]*)"?\)/.exec(style.backgroundImage)?.[1];
    if (tiled && style.backgroundRepeat.startsWith('repeat')) pieces.push({ key, box, clip, paint: { kind: 'picture', img: tileOf(tiled, loaded), cover: null, fade: undefined, tiled: true }, ...loops });
  };
  const pseudo = (node: Element, which: '::before' | '::after', clip: Box) => {
    const style = getComputedStyle(node, which);
    if (style.content === 'none' || style.content === 'normal') return;
    const box = within(node, frame);
    background(null, style, { x: box.x + parseFloat(style.left), y: box.y + parseFloat(style.top), w: parseFloat(style.width), h: parseFloat(style.height) }, clip, NO_LOOPS);
  };
  const visit = (node: Element, clip: Box) => {
    const style = getComputedStyle(node);
    if (style.display === 'none') return;
    const box = within(node, frame);
    const flickers = style.getPropertyValue('--flicker');
    const loops: Loops = {
      flicker: flickers ? { takes: seconds(flickers), flare: parseFloat(style.getPropertyValue('--flare')) || 1 } : null,
      fly: node.classList.contains(styles.fly) ? { takes: seconds(style.getPropertyValue('--takes')), after: seconds(style.getPropertyValue('--after')) } : null,
    };
    pseudo(node, '::before', clip);
    background(node, style, box, clip, loops);
    if (node instanceof HTMLImageElement) {
      const [x, y] = style.objectPosition.split(' ').map(share);
      pieces.push({ key: node, box, clip, paint: { kind: 'picture', img: node, cover: style.objectFit === 'cover' ? [x!, y!] : null, fade: parseFade(style.maskImage || style.webkitMaskImage) ?? undefined, tiled: false }, ...loops });
    }
    const inner = style.overflow === 'hidden' ? meet(clip, box) : clip;
    for (const child of node.children) visit(child, inner);
    pseudo(node, '::after', clip);
  };
  visit(root, ANYWHERE);
  return pieces;
}

function motionOf(root: HTMLElement, frame: DOMRect): Motion | null {
  const mover = root.firstElementChild;
  if (!mover) return null;
  const turns = mover.classList.contains(styles.bough);
  if (!turns && !mover.classList.contains(styles.sway)) return null;
  const style = getComputedStyle(mover);
  const token = (name: string) => style.getPropertyValue(name);
  return turns
    ? { origin: originOf(mover, within(mover, frame)), takes: seconds(token('--scene-bough-sway')), from: parseFloat(token('--scene-bough-from')), to: parseFloat(token('--scene-bough-to')), turns }
    : { origin: originOf(mover, within(mover, frame)), takes: seconds(token('--sway-takes')), from: parseFloat(token('--scene-sway-from')), to: parseFloat(token('--scene-sway-to')), turns };
}

// A loop's keyframes: where in the loop, then its values; each stretch eased.
const keyed = (keys: readonly (readonly number[])[], into: number, eased: (progress: number) => number) => {
  const after = Math.max(keys.findIndex(([at]) => at! > into), 1);
  const from = keys[after - 1]!;
  const to = keys[after]!;
  const progress = eased((into - from[0]!) / (to[0]! - from[0]!));
  return from.slice(1).map((value, index) => value + (to[index + 1]! - value) * progress);
};
// A flame: opacity and scale.
const FLICKER = [[0, 0.82, 1], [0.38, 1, 1.06], [0.62, 0.74, 0.97], [1, 0.82, 1]] as const;
// A firefly: opacity, then its drift across and up in reaches.
const DRIFT = [[0, 0, 0, 0], [0.2, 1, 1, -0.7], [0.45, 0.15, 0.4, -1.6], [0.65, 0.9, -0.8, -0.9], [1, 0, 0, 0]] as const;

// The tuned share whose place on this page's scroll is the real one.
const tunedAt = (pace: Pace, real: number) => {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 20; step++) {
    const at = (low + high) / 2;
    if (pace(at) < real) low = at;
    else high = at;
  }
  return (low + high) / 2;
};

// The part of the picture the box shows: tiled at its own size, or object-fit cover at an object-position.
const windowOf = (img: HTMLImageElement, box: Box, cover: readonly [number, number] | null, tiled: boolean): Box | undefined => {
  if (tiled) return { x: 0, y: 0, w: box.w / img.naturalWidth, h: box.h / img.naturalHeight };
  if (!cover) return undefined;
  const by = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
  const wide = img.naturalWidth * by;
  const tall = img.naturalHeight * by;
  return { x: ((wide - box.w) * cover[0]) / wide, y: ((tall - box.h) * cover[1]) / tall, w: box.w / wide, h: box.h / tall };
};

// answered: a step of the trial changed what the scene's CSS says, and what moved or lit eases there.
export type Painting = { refit: () => void; answered: () => void; aim: (at: { x: number; y: number }, looks: boolean) => void };

export function usePaintedScene(on: boolean, stage: RefObject<HTMLDivElement | null>, canvas: RefObject<HTMLCanvasElement | null>, layers: Map<HTMLElement, Layer>, pace: Pace) {
  const painting = useRef<Painting>({ refit: () => {}, answered: () => {}, aim: () => {} });
  const paceNow = useRef(pace);
  paceNow.current = pace;

  useEffect(() => {
    if (!on) return;
    const scene = stage.current!;
    const surface = canvas.current!;
    let frame = 0;
    let timer = 0;
    let fitted = false;
    let answering = false;
    let lastShare = NaN;
    let planned: Planned[] = [];
    let range = 1;
    let size: Screen = { w: 0, h: 0 };
    let artIn = 1;
    let lookReach = 0;
    let flyReach = 0;
    let answerTakes = 1;
    let answerEase = (progress: number) => progress;
    let loopEase = answerEase;
    const began = performance.now();
    const aimed = { x: 0.5, y: 0.5, looks: false };
    const tweens = new WeakMap<Element, Tween>();
    const before = new WeakMap<Element, { x: number; y: number; opacity: number }>();

    const repaint = () => {
      if (frame) return;
      clearTimeout(timer);
      frame = requestAnimationFrame(draw);
    };
    // The scene's nodes hide only while a painter shows them: a canvas WebGL2 would not open, or lost, leaves them standing still.
    let painter = painterOn(surface, repaint);
    const shown = () => {
      if (painter) scene.dataset['painted'] = '';
      else delete scene.dataset['painted'];
    };
    shown();

    const fit = (now: number) => {
      const frameOf = scene.getBoundingClientRect();
      size = { w: frameOf.width, h: frameOf.height };
      range = scrollRange();
      const tokens = getComputedStyle(scene);
      artIn = seconds(tokens.getPropertyValue('--scene-art-in')) * 1000;
      lookReach = parseFloat(tokens.getPropertyValue('--scene-look-reach'));
      flyReach = parseFloat(tokens.getPropertyValue('--scene-fly-reach'));
      answerTakes = seconds(tokens.getPropertyValue('--scene-answer')) * 1000;
      answerEase = easing(tokens.getPropertyValue('--ease-enter'));
      loopEase = easing(tokens.getPropertyValue('--ease-loop'));
      planned = [...layers]
        .sort(([one], [other]) => (one.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map(([root, layer]) => ({ root, layer, origin: originOf(root, within(root, frameOf)), opacity: parseFloat(getComputedStyle(root).opacity), motion: motionOf(root, frameOf), pieces: piecesOf(root, frameOf, repaint) }));
      for (const plan of planned) {
        const was = before.get(plan.root);
        if (answering && was && was.opacity !== plan.opacity) tweens.set(plan.root, { x: 0, y: 0, opacity: was.opacity - plan.opacity, began: now });
        before.set(plan.root, { x: 0, y: 0, opacity: plan.opacity });
        for (const { key, box } of plan.pieces) {
          if (!key) continue;
          const stood = before.get(key);
          if (answering && stood && (stood.x !== box.x || stood.y !== box.y)) tweens.set(key, { x: stood.x - box.x, y: stood.y - box.y, opacity: 0, began: now });
          before.set(key, { x: box.x, y: box.y, opacity: 1 });
        }
      }
      fitted = true;
      answering = false;
    };

    // How much of a tween is still to go.
    const left = (tween: Tween | undefined, now: number) => (tween ? 1 - answerEase(Math.min((now - tween.began) / answerTakes, 1)) : 0);

    const draw = (now: number) => {
      frame = 0;
      timer = 0;
      if (!painter) return;
      if (!fitted) fit(now);
      const at = tunedAt(paceNow.current, Math.min(Math.max(scrollY / range, 0), 1));
      const moved = at !== lastShare;
      lastShare = at;
      const time = (now - began) / 1000;
      let ambient = false;
      let fading = false;
      let tweening = false;
      painter.begin(size.w, size.h, Math.min(devicePixelRatio, DENSITY));
      for (const plan of planned) {
        const walked = plan.layer.walk?.(at, size) ?? {};
        const lit = tweens.get(plan.root);
        const settling = left(lit, now);
        if (settling) tweening = true;
        const opacity = walked.opacity ?? plan.opacity + (lit?.opacity ?? 0) * settling;
        if (opacity <= 0) continue;
        const looking = plan.layer.near && aimed.looks ? plan.layer.near * lookReach : 0;
        const carried = plan.layer.carried ? 1 : 0;
        let place: Affine = times(
          shift((aimed.x - 0.5) * looking + aimed.x * size.w * carried + (walked.x ?? 0), (aimed.y - 0.5) * looking * LOOK_RISE + aimed.y * size.h * carried + (walked.y ?? 0)),
          about(...plan.origin, scaling(walked.scale ?? 1)),
        );
        if (plan.motion) {
          ambient = true;
          const { takes, from, to, turns } = plan.motion;
          const into = (time / takes) % 1;
          const angle = from + (to - from) * loopEase(Math.floor(time / takes) % 2 ? 1 - into : into);
          place = times(place, about(...plan.motion.origin, turns ? turning(angle) : skewingX(angle)));
        }
        for (const piece of plan.pieces) {
          let piecePlace = place;
          let pieceOpacity = opacity;
          const moving = piece.key ? tweens.get(piece.key) : undefined;
          const still = left(moving, now);
          if (still) {
            tweening = true;
            piecePlace = times(piecePlace, shift(moving!.x * still, moving!.y * still));
          }
          if (piece.flicker) {
            ambient = true;
            const [flickerOpacity, flickerScale] = keyed(FLICKER, (time / piece.flicker.takes) % 1, loopEase);
            piecePlace = times(piecePlace, about(piece.box.x + piece.box.w / 2, piece.box.y + piece.box.h / 2, scaling(flickerScale! * piece.flicker.flare)));
            pieceOpacity *= flickerOpacity!;
          }
          if (piece.fly) {
            ambient = true;
            const [flyOpacity, across, up] = keyed(DRIFT, ((((time - piece.fly.after) / piece.fly.takes) % 1) + 1) % 1, loopEase);
            piecePlace = times(piecePlace, shift(across! * flyReach, up! * flyReach));
            pieceOpacity *= flyOpacity!;
          }
          if (pieceOpacity <= 0) continue;
          if (piece.paint.kind === 'gradient') {
            painter.gradient(piece.paint.gradient, piece.box, piecePlace, pieceOpacity, piece.clip);
            continue;
          }
          const { img, cover, fade, tiled } = piece.paint;
          const picture = painter.pictureOf(img, tiled);
          if (!picture) continue;
          const arrived = Math.min((now - picture.arrived) / artIn, 1);
          if (arrived < 1) fading = true;
          painter.picture(picture.texture!, piece.box, piecePlace, pieceOpacity * arrived, piece.clip, windowOf(img, piece.box, cover, tiled), fade);
        }
      }
      // Where the walk rests, for the e2e that holds every screen to the same scene at a stop.
      if (!moved && scene.dataset['walked'] !== at.toFixed(4)) scene.dataset['walked'] = at.toFixed(4);
      if (moved || fading || tweening) frame = requestAnimationFrame(draw);
      else if (ambient) timer = window.setTimeout(repaint, AMBIENT_GAP);
    };

    const refit = () => {
      fitted = false;
      repaint();
    };
    painting.current = {
      refit,
      answered: () => {
        answering = true;
        refit();
      },
      aim: ({ x, y }, looks) => {
        Object.assign(aimed, { x, y, looks });
        repaint();
      },
    };
    const resized = new ResizeObserver(refit);
    resized.observe(scene);
    const lost = (event: Event) => {
      event.preventDefault();
      painter = null;
      shown();
    };
    const restored = () => {
      painter = painterOn(surface, repaint);
      shown();
      repaint();
    };
    addEventListener('scroll', repaint, { passive: true });
    // A picture's box takes its height from the picture.
    scene.addEventListener('load', refit, true);
    surface.addEventListener('webglcontextlost', lost);
    surface.addEventListener('webglcontextrestored', restored);
    repaint();
    return () => {
      resized.disconnect();
      removeEventListener('scroll', repaint);
      scene.removeEventListener('load', refit, true);
      surface.removeEventListener('webglcontextlost', lost);
      surface.removeEventListener('webglcontextrestored', restored);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, []);

  return painting;
}
