import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { hasFinePointer, MEDIA } from '../foundation/media';
import { usePaintedScene, type Walked, type Walks } from './paintedScene';
import { along, paceOfPage, samePace, stillness, useWalkOn, type Pace } from './walkStops';
import arin from './art/arin.webp';
import boughTall from './art/bough-tall.webp';
import boughWide from './art/bough-wide.webp';
import cabin from './art/cabin.webp';
import hillTall from './art/hill-tall.webp';
import hillWide from './art/hill-wide.webp';
import moon from './art/moon.webp';
import ridgeTall from './art/ridge-tall.webp';
import ridgeWide from './art/ridge-wide.webp';
import roomTall from './art/room-tall.webp';
import roomWide from './art/room-wide.webp';
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

// How far the walk has come at a tuned share of the scroll: it slows at 아린's clearing and the lanterns while each is read, then closes on the cabin's door, reached as the threshold is crossed.
const WALK: readonly (readonly [number, number])[] = [[0, 0], [0.1725, 2100], [0.27, 2160], [0.331, 3250], [0.44, 3450], [0.512, 5800], [1, 7600]];
const LENS = 1000;
const NEAREST = 14;
const SAMPLES = 240;
const CLOCK = 1000;

type Frames = (pace: Pace) => Keyframe[];
const stops = (at: (share: number) => Keyframe): Frames => (pace) =>
  Array.from({ length: SAMPLES + 1 }, (_, index) => ({ ...at(index / SAMPLES), offset: pace(index / SAMPLES) }));
const between = (low: number, high: number, at: number) => Math.min(Math.max((at - low) / (high - low), 0), 1);
const smooth = (at: number) => at * at * (3 - 2 * at);

type Seen = { in?: readonly [number, number]; out?: readonly [number, number] };
const seenAt = ({ in: rise, out: fall }: Seen, share: number) => (rise ? between(rise[0], rise[1], share) : 1) * (fall ? 1 - between(fall[0], fall[1], share) : 1);

// Each plane grows as its nearness says: a flat picture and a scale, so no browser's 3D is asked to hold depths this far apart.
const planeAt = (z: number, seen: Seen) => (share: number): Walked => ({ scale: Math.min((z + LENS) / Math.max(z + LENS - along(WALK, share), 1), NEAREST), opacity: seenAt(seen, share) });

// The cabin grows by a steady ratio from far off to its doorway filling the screen. By nearness alone, as the other planes grow, nearly all of it would come in the last moment.
const DOOR_FAR = 1.1;
const DOOR_FILLS = 21.6;
const NEARING = [0.34, 0.5096] as const;
const doorAt = (seen: Seen) => (share: number): Walked => ({ scale: DOOR_FAR * (DOOR_FILLS / DOOR_FAR) ** Math.max((share - NEARING[0]) / (NEARING[1] - NEARING[0]), 0), opacity: seenAt(seen, share) });

const planeFrames = (at: (share: number) => Walked): Frames =>
  stops((share) => {
    const { scale, opacity } = at(share);
    return { transform: `scale(${scale.toFixed(4)})`, opacity: opacity.toFixed(3) };
  });

const SCROLL = typeof ScrollTimeline === 'function' ? new ScrollTimeline({ source: document.documentElement }) : null;
// A trial behind ?gl: the planes painted on one canvas instead of composited one by one.
const PAINTED = typeof WebGL2RenderingContext === 'function' && new URLSearchParams(location.search).has('gl') && !stillness();
const PaceOfPage = createContext<Pace>(samePace);
const PaintedWalks = createContext<{ walks: Walks; changed: () => void } | null>(null);

function useWalk(frames: Frames | null) {
  const node = useRef<HTMLDivElement>(null);
  const pace = useContext(PaceOfPage);
  useLayoutEffect(() => {
    if (!frames || stillness()) return;
    const animation = node.current!.animate(frames(pace), { duration: CLOCK, fill: 'both', easing: 'linear', ...(SCROLL ? { timeline: SCROLL } : {}) });
    if (!SCROLL) animation.pause();
    return () => animation.cancel();
  }, [pace]);
  return node;
}

// Far planes share pictures with near ones: seen at another depth, between other trees, a row reads as new.
// Each comes out of the fog well before it is near, so the fog does its far colors, and leaves before it fills the screen.
const ROWS: readonly { art: { wide: string; tall: string }; z: number; seen: Seen; takes?: string }[] = [
  { art: ROW_B, z: 19000, seen: { in: [0.3, 0.5], out: [0.84, 0.9] } },
  { art: ROW_D, z: 13000, seen: { in: [0.16, 0.36], out: [0.8, 0.86] } },
  { art: ROW_B, z: 8500, seen: { in: [0.1, 0.28], out: [0.72, 0.8] } },
  { art: ROW_D, z: 5500, seen: { in: [0.06, 0.2], out: [0.513, 0.52] } },
  { art: ROW_B, z: 3400, seen: { in: [0.04, 0.14], out: [0.38, 0.44] } },
  { art: ROW_D, z: 2000, seen: { in: [0.02, 0.1], out: [0.22, 0.27] } },
  { art: ROW_A, z: 1000, seen: { out: [0.1, 0.16] }, takes: '11s' },
  { art: ROW_B, z: 600, seen: { out: [0.07, 0.12] }, takes: '9s' },
  { art: ROW_C, z: 200, seen: { out: [0.05, 0.09] }, takes: '7s' },
];

// The room fully covers the forest from the threshold to 0.52 tuned, so what leaves there is never seen going.
const CABIN = { z: 5000, seen: { in: [0.345, 0.385], out: [0.513, 0.52] } } as const;
const ARIN = { z: 1500, seen: { out: [0.25, 0.275] } } as const;
const BOUGH = { z: 40, seen: { out: [0.02, 0.05] } } as const;
const HILL = { z: 40000, seen: { in: [0.78, 0.92] } } as const;
const RIDGE = { z: 60000, seen: {} } as const;

// On a tall screen the page's words reach across the moon's place, so it climbs clear of them while they are read.
const MOON: Frames = (pace) => {
  const climbs = matchMedia(MEDIA.tallScreen).matches ? 11 : 0;
  return stops((share) => {
    const climbed = climbs * between(0, 0.1725, share) * (1 - between(0.44, 0.84, share));
    return { transform: `translate3d(0, ${(share < 0.44 ? between(0, 0.44, share) * 5 : 5 + between(0.44, 0.84, share) * 69) - climbed}vh, 0)` };
  })(pace);
};
// Dissolves on the walk's own scale as the doorway closes in and on the way out, always moving the way the visitor walks, in either direction.
const ROOM = stops((share) => {
  const entered = smooth(between(0.455, 0.5096, share));
  const leaving = smooth(between(0.5096, 0.67, share));
  return { opacity: (entered * (1 - smooth(between(0.52, 0.67, share)))).toFixed(3), transform: `scale(${(0.9 + entered * 0.1 + leaving * 0.14).toFixed(4)})` };
});
const DAWN = stops((share) => ({ opacity: between(0.56, 1, share) }));
// The carried lantern dips and rises with each step of the walk, and is not needed once the sun is up.
const STRIDES = 22;
const STEP = stops((share) => ({ transform: `translate3d(${Math.sin(share * STRIDES * Math.PI) * 9}px, ${Math.abs(Math.cos(share * STRIDES * Math.PI)) * 14}px, 0)`, opacity: 1 - between(0.68, 0.9, share) }));
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

function Plane({ z, seen, doorward, children }: { z: number; seen: Seen; doorward?: boolean; children: ReactNode }) {
  const at = doorward ? doorAt(seen) : planeAt(z, seen);
  const painted = useContext(PaintedWalks);
  const node = useWalk(painted ? null : planeFrames(at));
  useLayoutEffect(() => {
    if (!painted) return;
    const plane = node.current!;
    painted.walks.set(plane, at);
    painted.changed();
    return () => {
      painted.walks.delete(plane);
      painted.changed();
    };
  }, []);
  return (
    <div className={styles.look} style={{ '--near': (LENS / (LENS + z)).toFixed(3) } as CSSProperties}>
      <div ref={node} className={doorward ? `${styles.plane} ${styles.doorward}` : styles.plane}>{children}</div>
    </div>
  );
}

function Moving({ className, frames, children }: { className: string; frames: Frames; children?: ReactNode }) {
  const node = useWalk(frames);
  return <div ref={node} className={className}>{children}</div>;
}

// glow: how far the visitor has come (0 to 3), told by the trial's steps. talking: 아린 is answering. inside: past the cabin's threshold.
export function NightScene({ glow, talking, inside }: { glow: number; talking: boolean; inside: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const lantern = useRef<HTMLDivElement>(null);
  const [walking, setWalking] = useState(false);
  const [pace, setPace] = useState<Pace>(() => samePace);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [walks] = useState<Walks>(() => new Map());
  const painting = usePaintedScene(PAINTED, stage, canvas, walks, pace);
  const [painted] = useState(() => (PAINTED ? { walks, changed: () => painting.current.refit() } : null));
  useWalkOn();

  useEffect(() => {
    painting.current.refit();
  }, [talking]);

  useLayoutEffect(() => {
    if (stillness()) return;
    // Measured against the page's content, not the window: a phone's bars coming and going must not rebuild the walk mid-scroll.
    let fitted = '';
    const fit = () => {
      const size = `${document.body.offsetWidth}x${document.body.offsetHeight}`;
      if (size === fitted) return;
      fitted = size;
      setPace(() => paceOfPage());
    };
    fit();
    const refit = new ResizeObserver(fit);
    refit.observe(document.body);
    return () => refit.disconnect();
  }, []);

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
  }, [walking, pace]);

  useEffect(() => {
    if (stillness()) return;
    const node = stage.current!;
    const carried = lantern.current!;
    // A finger also moves the lantern, but looking around stays with a mouse: it restyles every plane, which a phone pays for.
    const looks = hasFinePointer();
    const aim = matchMedia(MEDIA.tallScreen).matches ? { x: 0.5, y: 0.66 } : { x: 0.62, y: 0.68 };
    const now = { ...aim };
    let frame = 0;
    const place = () => {
      carried.style.transform = `translate3d(${now.x * innerWidth}px, ${now.y * innerHeight}px, 0)`;
    };
    const settle = () => {
      now.x += (aim.x - now.x) * 0.08;
      now.y += (aim.y - now.y) * 0.08;
      place();
      if (looks) {
        node.style.setProperty('--look-x', now.x.toFixed(4));
        node.style.setProperty('--look-y', now.y.toFixed(4));
        painting.current.looked();
      }
      frame = Math.abs(aim.x - now.x) + Math.abs(aim.y - now.y) > 0.0008 ? requestAnimationFrame(settle) : 0;
    };
    const point = (x: number, y: number) => {
      aim.x = x / innerWidth;
      aim.y = y / innerHeight;
      if (!frame) frame = requestAnimationFrame(settle);
    };
    const moved = ({ clientX, clientY }: PointerEvent) => point(clientX, clientY);
    // A scrolling finger stops sending pointer events almost at once; touch events keep coming.
    const touched = ({ touches }: TouchEvent) => point(touches[0]!.clientX, touches[0]!.clientY);
    place();
    addEventListener('pointermove', moved, { passive: true });
    addEventListener('touchstart', touched, { passive: true });
    addEventListener('touchmove', touched, { passive: true });
    addEventListener('resize', place);
    return () => {
      removeEventListener('pointermove', moved);
      removeEventListener('touchstart', touched);
      removeEventListener('touchmove', touched);
      removeEventListener('resize', place);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <PaceOfPage.Provider value={pace}>
      <PaintedWalks.Provider value={painted}>
      <div ref={stage} className={styles.scene} data-glow={glow} data-talking={talking || undefined} data-inside={inside || undefined} data-painted={painted ? '' : undefined} aria-hidden="true">
        <div className={styles.flat}><Art wide={skyWide} tall={skyTall} priority /></div>
        <Moving className={styles.moonPath} frames={MOON}>
          <div className={styles.halo} />
          <img className={styles.moon} src={moon} alt="" decoding="async" />
        </Moving>
        <Moving className={styles.dawn} frames={DAWN} />
        <Moving className={styles.sun} frames={SUN} />
        <Plane {...RIDGE}><Art wide={ridgeWide} tall={ridgeTall} /></Plane>
        {walking && <Plane {...HILL}><Art wide={hillWide} tall={hillTall} /></Plane>}
        {ROWS.map(({ art, z, seen, takes }) => (seen.in && !walking ? null : (
          <Plane key={z} z={z} seen={seen}>
            {takes ? <div className={styles.sway} style={{ '--sway-takes': takes } as CSSProperties}><Art wide={art.wide} tall={art.tall} priority={z === 200} /></div> : <Art wide={art.wide} tall={art.tall} />}
          </Plane>
        )))}
        {walking && (
          <Plane {...CABIN} doorward>
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
        {painted && <canvas ref={canvas} className={styles.painted} />}
        <div className={styles.haze} />
        <div className={styles.warmth} />
        <div ref={lantern} className={styles.lantern}>
          <Moving className={styles.step} frames={STEP}>
            <div className={styles.veil} />
            <div className={styles.carried} />
          </Moving>
        </div>
        <div className={styles.flies}>
          {FIREFLIES.map(({ key, style }) => (
            <div key={key} className={styles.gather} style={style}>
              <div className={styles.fly} />
            </div>
          ))}
        </div>
        {(walking || inside) && (
          <Moving className={styles.room} frames={ROOM}>
            <div className={styles.roomPicture}>
              <Art wide={roomWide} tall={roomTall} />
              <div className={styles.roomHearth} />
              <div className={styles.roomLamp} />
            </div>
          </Moving>
        )}
        <div className={styles.grain} />
        <div className={styles.curtain} />
      </div>
      </PaintedWalks.Provider>
    </PaceOfPage.Provider>
  );
}
