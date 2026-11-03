import { useEffect, useRef, type RefObject } from 'react';
import styles from './NightScene.module.css';
import { about, painterOn, parseFade, parseGradients, scaling, share, shift, skewingX, times, turning, type Affine, type Box, type Fade, type Radial } from './paint';
import type { Pace } from './walkStops';

export type Walked = { scale: number; opacity: number };
// Each plane's node, with where the walk has it at a tuned share of the scroll.
export type Walks = Map<HTMLElement, (share: number) => Walked>;

// The pictures are painted at most this many pixels to a CSS pixel: none of them holds more than about two at a phone's size.
const DENSITY = 1.5;
// Between frames when only the breeze and the flames move.
const AMBIENT_GAP = 33;

type Piece =
  | { kind: 'picture'; img: HTMLImageElement; box: Box; cover: readonly [number, number] | null; fade: Fade | undefined }
  | { kind: 'glow'; box: Box; radials: Radial[]; flare: number | null };
type Motion = { origin: readonly [number, number]; takes: number; from: number; to: number; turns: boolean };
type Planned = { look: HTMLElement; walk: (share: number) => Walked; origin: readonly [number, number]; motion: Motion | null; pieces: Piece[]; shifted: readonly [number, number] };

const seconds = (text: string) => parseFloat(text) / (text.trim().endsWith('ms') ? 1000 : 1);
const within = (node: Element, frame: DOMRect): Box => {
  const { left, top, width, height } = node.getBoundingClientRect();
  return { x: left - frame.left, y: top - frame.top, w: width, h: height };
};
const originOf = (node: Element, box: Box) => {
  const [x, y] = getComputedStyle(node).transformOrigin.split(' ').map(parseFloat);
  return [box.x + x!, box.y + y!] as const;
};

// The scene's CSS lays every piece out; only the walk's transforms and the loops below are painted instead of styled.
function piecesOf(plane: HTMLElement, frame: DOMRect) {
  const pieces: Piece[] = [];
  const glow = (node: Element, pseudo?: '::before' | '::after') => {
    const style = getComputedStyle(node, pseudo);
    if (!style.backgroundImage.includes('radial-gradient')) return;
    const box = within(node, frame);
    pieces.push({
      kind: 'glow',
      box: pseudo ? { x: box.x + parseFloat(style.left), y: box.y + parseFloat(style.top), w: parseFloat(style.width), h: parseFloat(style.height) } : box,
      radials: parseGradients(style.backgroundImage),
      flare: node.classList.contains(styles.arinGlow) ? parseFloat(style.getPropertyValue('--flare')) || 1 : null,
    });
  };
  const visit = (node: Element) => {
    glow(node, '::before');
    if (node instanceof HTMLImageElement) {
      const style = getComputedStyle(node);
      const [x, y] = style.objectPosition.split(' ').map(share);
      pieces.push({ kind: 'picture', img: node, box: within(node, frame), cover: style.objectFit === 'cover' ? [x!, y!] : null, fade: parseFade(style.maskImage || style.webkitMaskImage) ?? undefined });
    } else glow(node);
    for (const child of node.children) visit(child);
    glow(node, '::after');
  };
  visit(plane);
  return pieces;
}

function motionOf(plane: HTMLElement, frame: DOMRect): Motion | null {
  const mover = plane.firstElementChild!;
  const turns = mover.classList.contains(styles.bough);
  if (!turns && !mover.classList.contains(styles.sway)) return null;
  const style = getComputedStyle(mover);
  const token = (name: string) => style.getPropertyValue(name);
  return turns
    ? { origin: originOf(mover, within(mover, frame)), takes: seconds(token('--scene-bough-sway')), from: parseFloat(token('--scene-bough-from')), to: parseFloat(token('--scene-bough-to')), turns }
    : { origin: originOf(mover, within(mover, frame)), takes: seconds(token('--sway-takes')), from: parseFloat(token('--scene-sway-from')), to: parseFloat(token('--scene-sway-to')), turns };
}

// ease-in-out, the scene's --ease-loop.
const eased = (progress: number) => {
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step++) {
    const at = (low + high) / 2;
    if (3 * (1 - at) ** 2 * at * 0.42 + 3 * (1 - at) * at * at * 0.58 + at ** 3 < progress) low = at;
    else high = at;
  }
  const at = (low + high) / 2;
  return 3 * (1 - at) * at * at + at ** 3;
};

// An alternating loop, eased both ways.
const swayed = ({ takes, from, to }: Motion, time: number) => {
  const turns = time / takes;
  const into = turns % 1;
  return from + (to - from) * eased(Math.floor(turns) % 2 ? 1 - into : into);
};

// The flame's flicker, as @keyframes flicker in NightScene.module.css, which still runs the room's lights: change the two together.
const FLICKER = [[0, 0.82, 1], [0.38, 1, 1.06], [0.62, 0.74, 0.97], [1, 0.82, 1]] as const;
const flickered = (time: number, takes: number) => {
  const into = (time / takes) % 1;
  const after = FLICKER.findIndex(([at]) => at > into);
  const [fromAt, fromOpacity, fromScale] = FLICKER[after - 1]!;
  const [toAt, toOpacity, toScale] = FLICKER[after]!;
  const progress = eased((into - fromAt) / (toAt - fromAt));
  return { opacity: fromOpacity + (toOpacity - fromOpacity) * progress, scale: fromScale + (toScale - fromScale) * progress };
};

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

// cover: object-fit cover at an object-position, as the part of the picture the box shows.
const windowOf = (img: HTMLImageElement, box: Box, [x, y]: readonly [number, number]): Box => {
  const by = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
  const wide = img.naturalWidth * by;
  const tall = img.naturalHeight * by;
  return { x: ((wide - box.w) * x) / wide, y: ((tall - box.h) * y) / tall, w: box.w / wide, h: box.h / tall };
};

export type Painting = { refit: () => void; looked: () => void };

export function usePaintedScene(on: boolean, stage: RefObject<HTMLDivElement | null>, canvas: RefObject<HTMLCanvasElement | null>, walks: Walks, pace: Pace) {
  const painting = useRef<Painting>({ refit: () => {}, looked: () => {} });
  const paceNow = useRef(pace);
  paceNow.current = pace;

  useEffect(() => {
    if (!on) return;
    const scene = stage.current!;
    const surface = canvas.current!;
    let frame = 0;
    let timer = 0;
    let fitted = false;
    let looks = true;
    let lastShare = NaN;
    let planned: Planned[] = [];
    let range = 1;
    let size = { w: 0, h: 0 };
    let artIn = 1;
    let flickerTakes = 1;

    const repaint = () => {
      if (frame) return;
      clearTimeout(timer);
      frame = requestAnimationFrame(draw);
    };
    // The planes hide only while a painter shows them: a canvas WebGL2 would not open, or lost, leaves them standing.
    let painter = painterOn(surface, repaint);
    const shown = () => {
      if (painter) scene.dataset['painted'] = '';
      else delete scene.dataset['painted'];
    };
    shown();

    const fit = () => {
      const { width, height } = scene.getBoundingClientRect();
      size = { w: width, h: height };
      range = Math.max(document.documentElement.scrollHeight - document.documentElement.clientHeight, 1);
      const tokens = getComputedStyle(scene);
      artIn = seconds(tokens.getPropertyValue('--scene-art-in')) * 1000;
      flickerTakes = seconds(tokens.getPropertyValue('--scene-flicker'));
      planned = [...walks]
        .sort(([one], [other]) => (one.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map(([plane, walk]) => {
          const look = plane.parentElement!;
          const frameOf = look.getBoundingClientRect();
          return { look, walk, origin: originOf(plane, within(plane, frameOf)), motion: motionOf(plane, frameOf), pieces: piecesOf(plane, frameOf), shifted: [0, 0] };
        });
      fitted = true;
      looks = true;
    };

    const draw = (now: number) => {
      frame = 0;
      timer = 0;
      if (!painter) return;
      if (!fitted) fit();
      if (looks) {
        for (const plane of planned) {
          const { e, f } = new DOMMatrixReadOnly(getComputedStyle(plane.look).transform);
          plane.shifted = [e, f];
        }
        looks = false;
      }
      const at = tunedAt(paceNow.current, Math.min(Math.max(scrollY / range, 0), 1));
      const moved = at !== lastShare;
      lastShare = at;
      const time = now / 1000;
      let ambient = false;
      let fading = false;
      painter.begin(size.w, size.h, Math.min(devicePixelRatio, DENSITY));
      for (const plane of planned) {
        const { scale, opacity } = plane.walk(at);
        if (opacity <= 0) continue;
        let place: Affine = times(shift(...plane.shifted), about(...plane.origin, scaling(scale)));
        if (plane.motion) {
          ambient = true;
          const angle = swayed(plane.motion, time);
          place = times(place, about(...plane.motion.origin, plane.motion.turns ? turning(angle) : skewingX(angle)));
        }
        for (const piece of plane.pieces) {
          if (piece.kind === 'picture') {
            const picture = painter.pictureOf(piece.img);
            if (!picture) continue;
            const shown = Math.min((now - picture.arrived) / artIn, 1);
            if (shown < 1) fading = true;
            painter.picture(picture.texture!, piece.box, place, opacity * shown, piece.cover ? windowOf(piece.img, piece.box, piece.cover) : undefined, piece.fade);
            continue;
          }
          let glowAt = place;
          let glowing = opacity;
          if (piece.flare !== null) {
            ambient = true;
            const flame = flickered(time, flickerTakes);
            glowAt = times(place, about(piece.box.x + piece.box.w / 2, piece.box.y + piece.box.h / 2, scaling(flame.scale * piece.flare)));
            glowing *= flame.opacity;
          }
          for (const radial of piece.radials) painter.glow(radial, piece.box, glowAt, glowing);
        }
      }
      if (moved || fading) frame = requestAnimationFrame(draw);
      else if (ambient) timer = window.setTimeout(repaint, AMBIENT_GAP);
    };

    const refit = () => {
      fitted = false;
      repaint();
    };
    painting.current = {
      refit,
      looked: () => {
        looks = true;
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
