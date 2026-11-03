import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { hasFinePointer, MEDIA, mediaQuery } from '../foundation/media';
import { LayersOfScene, useLayer, usePaintedScene, type Layer, type Walk, type Walked } from './paintedScene';
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

// The scene is painted on one canvas: a phone composites one layer instead of dozens of growing pictures and glows. Without WebGL2 or with reduced motion it stands still.
const PAINTS = typeof WebGL2RenderingContext === 'function' && !stillness();

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

const tallScreen = mediaQuery(MEDIA.tallScreen);
// On a tall screen the page's words reach across the moon's place, so it climbs clear of them while they are read.
const MOON: Walk = (share, { h }) => {
  const climbed = (tallScreen.read() ? 11 : 0) * between(0, 0.1725, share) * (1 - between(0.44, 0.84, share));
  return { y: (((share < 0.44 ? between(0, 0.44, share) * 5 : 5 + between(0.44, 0.84, share) * 69) - climbed) * h) / 100 };
};
// Dissolves on the walk's own scale as the doorway closes in and on the way out, always moving the way the visitor walks, in either direction.
const ROOM: Walk = (share) => {
  const entered = smooth(between(0.455, 0.5096, share));
  const leaving = smooth(between(0.5096, 0.67, share));
  return { opacity: entered * (1 - smooth(between(0.52, 0.67, share))), scale: 0.9 + entered * 0.1 + leaving * 0.14 };
};
const DAWN: Walk = (share) => ({ opacity: between(0.56, 1, share) });
// The carried lantern dips and rises with each step of the walk, and is not needed once the sun is up.
const STRIDES = 22;
const STEP: Walk = (share) => ({ x: Math.sin(share * STRIDES * Math.PI) * 9, y: Math.abs(Math.cos(share * STRIDES * Math.PI)) * 14, opacity: 1 - between(0.68, 0.9, share) });
const SUN: Walk = (share, { h }) => ({ y: ((1 - between(0.74, 1, share)) * 34 * h) / 100, opacity: between(0.74, 1, share) });

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

function Painted({ className, layer = {}, children }: { className: string; layer?: Layer; children?: ReactNode }) {
  const node = useLayer(layer);
  return <div ref={node} className={className}>{children}</div>;
}

const Plane = ({ z, seen, doorward, children }: { z: number; seen: Seen; doorward?: boolean; children: ReactNode }) => (
  <Painted className={doorward ? `${styles.plane} ${styles.doorward}` : styles.plane} layer={{ walk: doorward ? doorAt(seen) : planeAt(z, seen), near: LENS / (LENS + z) }}>
    {children}
  </Painted>
);

// glow: how far the visitor has come (0 to 3), told by the trial's steps. talking: 아린 is answering. inside: past the cabin's threshold.
export function NightScene({ glow, talking, inside }: { glow: number; talking: boolean; inside: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [walking, setWalking] = useState(false);
  const [pace, setPace] = useState<Pace>(() => samePace);
  const [layers] = useState(() => new Map<HTMLElement, Layer>());
  const painting = usePaintedScene(PAINTS, stage, canvas, layers, pace);
  const [ofScene] = useState(() => ({ layers, changed: () => painting.current.refit() }));
  useWalkOn();

  useEffect(() => {
    painting.current.refit();
  }, [talking]);

  useEffect(() => {
    painting.current.answered();
  }, [glow]);

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
    if (!PAINTS) return;
    // A finger also moves the lantern, but looking around stays with a mouse.
    const looks = hasFinePointer();
    const aim = tallScreen.read() ? { x: 0.5, y: 0.66 } : { x: 0.62, y: 0.68 };
    const now = { ...aim };
    let frame = 0;
    const settle = () => {
      now.x += (aim.x - now.x) * 0.08;
      now.y += (aim.y - now.y) * 0.08;
      painting.current.aim(now, looks);
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
    painting.current.aim(now, looks);
    addEventListener('pointermove', moved, { passive: true });
    addEventListener('touchstart', touched, { passive: true });
    addEventListener('touchmove', touched, { passive: true });
    return () => {
      removeEventListener('pointermove', moved);
      removeEventListener('touchstart', touched);
      removeEventListener('touchmove', touched);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <LayersOfScene value={ofScene}>
      <div ref={stage} className={styles.scene} data-glow={glow} data-talking={talking || undefined} data-inside={inside || undefined} aria-hidden="true">
        <Painted className={styles.flat}><Art wide={skyWide} tall={skyTall} priority /></Painted>
        <Painted className={styles.moonPath} layer={{ walk: MOON }}>
          <div className={styles.halo} />
          <img className={styles.moon} src={moon} alt="" decoding="async" />
        </Painted>
        <Painted className={styles.dawn} layer={{ walk: DAWN }} />
        <Painted className={styles.sun} layer={{ walk: SUN }} />
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
        <Painted className={styles.haze} />
        <Painted className={styles.warmth} />
        <div className={styles.lantern}>
          <Painted className={styles.step} layer={{ walk: STEP, carried: true }}>
            <div className={styles.veil} />
            <div className={styles.carried} />
          </Painted>
        </div>
        <Painted className={styles.flies}>
          {FIREFLIES.map(({ key, style }) => (
            <div key={key} className={styles.gather} style={style}>
              <div className={styles.fly} />
            </div>
          ))}
        </Painted>
        {(walking || inside) && (
          <Painted className={styles.room} layer={{ walk: ROOM }}>
            <div className={styles.roomPicture}>
              <Art wide={roomWide} tall={roomTall} />
              <div className={styles.roomHearth} />
              <div className={styles.roomLamp} />
            </div>
          </Painted>
        )}
        <Painted className={styles.grain} />
        {PAINTS && <canvas ref={canvas} className={styles.painted} />}
      </div>
    </LayersOfScene>
  );
}
