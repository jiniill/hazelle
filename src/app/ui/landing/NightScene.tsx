import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { hasFinePointer, MEDIA } from '../foundation/media';
import arin from './art/arin.webp';
import boughTall from './art/bough-tall.webp';
import boughWide from './art/bough-wide.webp';
import cabin from './art/cabin.webp';
import hillTall from './art/hill-tall.webp';
import hillWide from './art/hill-wide.webp';
import moon from './art/moon.webp';
import ridgeTall from './art/ridge-tall.webp';
import ridgeWide from './art/ridge-wide.webp';
import rowATall from './art/rowA-tall.webp';
import rowAWide from './art/rowA-wide.webp';
import rowBTall from './art/rowB-tall.webp';
import rowBWide from './art/rowB-wide.webp';
import rowCTall from './art/rowC-tall.webp';
import rowCWide from './art/rowC-wide.webp';
import rowDTall from './art/rowD-tall.webp';
import rowDWide from './art/rowD-wide.webp';
import skyTall from './art/sky-tall.webp';
import skyWide from './art/sky-wide.webp';
import styles from './NightScene.module.css';

const ROW_A = { wide: rowAWide, tall: rowATall };
const ROW_B = { wide: rowBWide, tall: rowBTall };
const ROW_C = { wide: rowCWide, tall: rowCTall };
const ROW_D = { wide: rowDWide, tall: rowDTall };

// How far the walk has come at a share of the page's scroll: it slows at 아린's clearing, the lanterns and the cabin, while each is read.
const WALK: readonly (readonly [number, number])[] = [[0, 0], [0.19, 2050], [0.27, 2140], [0.37, 3100], [0.44, 3400], [0.58, 4400], [0.7, 4640], [1, 7600]];
const LENS = 1000;
const NEAREST = 14;
const SAMPLES = 40;
const CLOCK = 1000;

const walked = (share: number) => {
  const after = WALK.findIndex(([at]) => at >= share);
  if (after <= 0) return 0;
  const [fromShare, fromWalk] = WALK[after - 1]!;
  const [toShare, toWalk] = WALK[after]!;
  return fromWalk + ((share - fromShare) / (toShare - fromShare)) * (toWalk - fromWalk);
};
const between = (low: number, high: number, at: number) => Math.min(Math.max((at - low) / (high - low), 0), 1);

type Seen = { in?: readonly [number, number]; out?: readonly [number, number] };
const seenAt = ({ in: rise, out: fall }: Seen, share: number) => (rise ? between(rise[0], rise[1], share) : 1) * (fall ? 1 - between(fall[0], fall[1], share) : 1);

// Each plane grows as its nearness says: a flat picture and a scale, so no browser's 3D is asked to hold depths this far apart.
const planeFrames = (z: number, seen: Seen): Keyframe[] =>
  Array.from({ length: SAMPLES + 1 }, (_, index) => {
    const share = index / SAMPLES;
    const left = Math.max(z + LENS - walked(share), 1);
    return { transform: `scale(${Math.min((z + LENS) / left, NEAREST).toFixed(4)})`, opacity: seenAt(seen, share).toFixed(3) };
  });

const SCROLL = typeof ScrollTimeline === 'function' ? new ScrollTimeline({ source: document.documentElement }) : null;
const stillness = () => matchMedia(MEDIA.reducedMotion).matches;

function useWalk(frames: () => Keyframe[]) {
  const node = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (stillness()) return;
    const animation = node.current!.animate(frames(), { duration: CLOCK, fill: 'both', easing: 'linear', ...(SCROLL ? { timeline: SCROLL } : {}) });
    if (!SCROLL) animation.pause();
    return () => animation.cancel();
  }, []);
  return node;
}

// Far planes share pictures with near ones: seen at another depth, between other trees, a row reads as new.
// Each comes out of the fog well before it is near, so the fog does its far colors, and leaves before it fills the screen.
const ROWS = [
  { art: ROW_B, z: 19000, seen: { in: [0.3, 0.5], out: [0.84, 0.9] } },
  { art: ROW_D, z: 13000, seen: { in: [0.16, 0.36], out: [0.8, 0.86] } },
  { art: ROW_B, z: 8500, seen: { in: [0.1, 0.28], out: [0.72, 0.8] } },
  { art: ROW_D, z: 5500, seen: { in: [0.06, 0.2], out: [0.58, 0.66] } },
  { art: ROW_B, z: 3400, seen: { in: [0.04, 0.14], out: [0.38, 0.44] } },
  { art: ROW_D, z: 2000, seen: { in: [0.02, 0.1], out: [0.22, 0.27] } },
  { art: ROW_A, z: 1000, seen: { out: [0.1, 0.16] } },
  { art: ROW_B, z: 600, seen: { out: [0.07, 0.12] } },
  { art: ROW_C, z: 200, seen: { out: [0.05, 0.09] } },
] as const;

const CABIN = { z: 5000, seen: { in: [0.42, 0.52], out: [0.665, 0.71] } } as const;
const ARIN = { z: 1500, seen: { out: [0.25, 0.275] } } as const;
const BOUGH = { z: 40, seen: { out: [0.02, 0.05] } } as const;
const HILL = { z: 40000, seen: { in: [0.78, 0.92] } } as const;
const RIDGE = { z: 60000, seen: {} } as const;

const stops = (at: (share: number) => Keyframe) => () => Array.from({ length: SAMPLES + 1 }, (_, index) => at(index / SAMPLES));
const MOON = stops((share) => ({ transform: `translate3d(0, ${share < 0.44 ? between(0, 0.44, share) * 5 : 5 + between(0.44, 0.84, share) * 69}vh, 0)` }));
const DAWN = stops((share) => ({ opacity: between(0.66, 1, share) }));
const SUN = stops((share) => ({ transform: `translate3d(0, ${(1 - between(0.74, 1, share)) * 34}vh, 0)`, opacity: between(0.74, 1, share) }));

const FIREFLIES = Array.from({ length: 16 }, (_, index) => {
  const x = (index * 37 + 11) % 100;
  const y = 44 + ((index * 53) % 50);
  return { key: index, style: { '--at-x': `${x}%`, '--at-y': `${y}%`, '--gather-x': `${(62 - x) * 0.62}vw`, '--gather-y': `${(64 - y) * 0.62}vh`, '--after': `${-((index * 7) % 23)}s`, '--takes': `${11 + (index % 7) * 2}s` } as CSSProperties };
});

const ready = ({ currentTarget }: SyntheticEvent<HTMLImageElement>) => {
  currentTarget.dataset['ready'] = '';
};

function Art({ wide, tall, priority }: { wide: string; tall: string; priority?: boolean }) {
  return (
    <picture>
      <source media={MEDIA.tallScreen} srcSet={tall} />
      <img className={styles.art} src={wide} alt="" decoding="async" fetchPriority={priority ? 'high' : 'auto'} onLoad={ready} />
    </picture>
  );
}

function Plane({ z, seen, children }: { z: number; seen: Seen; children: ReactNode }) {
  const node = useWalk(() => planeFrames(z, seen));
  return (
    <div className={styles.look} style={{ '--near': (LENS / (LENS + z)).toFixed(3) } as CSSProperties}>
      <div ref={node} className={styles.plane}>{children}</div>
    </div>
  );
}

function Moving({ className, frames, children }: { className: string; frames: () => Keyframe[]; children?: ReactNode }) {
  const node = useWalk(frames);
  return <div ref={node} className={className}>{children}</div>;
}

// glow: how far the visitor has come (0 to 3), told by the door's steps. talking: 아린 is answering.
export function NightScene({ glow, talking }: { glow: number; talking: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const [walking, setWalking] = useState(false);

  useEffect(() => {
    if (stillness()) return;
    // What stands further along waits for a first step, so someone who only reads the top never fetches it.
    const begin = () => setWalking(true);
    addEventListener('scroll', begin, { once: true, passive: true });
    return () => removeEventListener('scroll', begin);
  }, []);

  useEffect(() => {
    if (SCROLL) return;
    // A browser with no scroll timeline runs the same animations, paused, with the page's scroll setting their clock.
    const node = stage.current!;
    const follow = () => {
      const share = Math.min(scrollY / Math.max(document.documentElement.scrollHeight - innerHeight, 1), 1);
      for (const animation of node.getAnimations({ subtree: true })) if (animation.playState === 'paused') animation.currentTime = share * CLOCK;
    };
    follow();
    addEventListener('scroll', follow, { passive: true });
    addEventListener('resize', follow);
    return () => {
      removeEventListener('scroll', follow);
      removeEventListener('resize', follow);
    };
  }, [walking]);

  useEffect(() => {
    if (!hasFinePointer() || stillness()) return;
    const node = stage.current!;
    const aim = { x: 0.5, y: 0.5 };
    const now = { x: 0.5, y: 0.5 };
    let frame = 0;
    const settle = () => {
      now.x += (aim.x - now.x) * 0.08;
      now.y += (aim.y - now.y) * 0.08;
      node.style.setProperty('--look-x', now.x.toFixed(4));
      node.style.setProperty('--look-y', now.y.toFixed(4));
      frame = Math.abs(aim.x - now.x) + Math.abs(aim.y - now.y) > 0.0008 ? requestAnimationFrame(settle) : 0;
    };
    const move = ({ clientX, clientY }: PointerEvent) => {
      aim.x = clientX / innerWidth;
      aim.y = clientY / innerHeight;
      node.dataset['lit'] = '';
      if (!frame) frame = requestAnimationFrame(settle);
    };
    addEventListener('pointermove', move, { passive: true });
    return () => {
      removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={stage} className={styles.scene} data-glow={glow} data-talking={talking || undefined} aria-hidden="true">
      <div className={styles.flat}><Art wide={skyWide} tall={skyTall} priority /></div>
      <Moving className={styles.moonPath} frames={MOON}>
        <div className={styles.halo} />
        <img className={styles.moon} src={moon} alt="" decoding="async" />
      </Moving>
      <Moving className={styles.dawn} frames={DAWN} />
      <Moving className={styles.sun} frames={SUN} />
      <Plane {...RIDGE}><Art wide={ridgeWide} tall={ridgeTall} /></Plane>
      {walking && <Plane {...HILL}><Art wide={hillWide} tall={hillTall} /></Plane>}
      {ROWS.map(({ art, z, seen }) => ('in' in seen && !walking ? null : (
        <Plane key={z} z={z} seen={seen}><Art wide={art.wide} tall={art.tall} priority={z === 200} /></Plane>
      )))}
      {walking && (
        <Plane {...CABIN}>
          <div className={styles.cabin}><img src={cabin} alt="" decoding="async" onLoad={ready} /></div>
        </Plane>
      )}
      <Plane {...ARIN}>
        <div className={styles.arin}>
          <img src={arin} alt="" decoding="async" />
          <div className={styles.arinGlow} />
        </div>
      </Plane>
      <Plane {...BOUGH}>
        <div className={styles.bough}><Art wide={boughWide} tall={boughTall} /></div>
      </Plane>
      <div className={styles.haze} />
      <div className={styles.warmth} />
      <div className={styles.flies}>
        {FIREFLIES.map(({ key, style }) => (
          <div key={key} className={styles.gather} style={style}>
            <div className={styles.fly} />
          </div>
        ))}
      </div>
      <div className={styles.carried} />
      <div className={styles.grain} />
      <div className={styles.curtain} />
    </div>
  );
}
