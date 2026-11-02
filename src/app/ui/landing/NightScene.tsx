import motion from '../foundation/motion.module.css';
import styles from './NightScene.module.css';

type Dot = { x: number; y: number; r: number };

// A fixed seed, so the forest stands the same on every visit and in every test.
function scatter(seed: number, count: number, make: (next: () => number, index: number) => Dot): Dot[] {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => make(next, index));
}

const WIDTH = 1600;
const HEIGHT = 900;

const STARS = scatter(7, 70, (next) => ({ x: next() * WIDTH, y: next() * HEIGHT * 0.62, r: 0.8 + next() * 1.3 }));
// Round crowns in a row: the hazel's shape, and the round letters of the name.
const crowns = (seed: number, count: number, top: number, spread: number, smallest: number, largest: number) =>
  scatter(seed, count, (next, index) => ({ x: (index / (count - 1)) * WIDTH + (next() - 0.5) * 40, y: top + next() * spread, r: smallest + next() * (largest - smallest) }));
const FAR = crowns(11, 34, 610, 70, 44, 82);
const MID = crowns(23, 20, 690, 80, 80, 140);
const NEAR = crowns(41, 11, 830, 90, 130, 230);

function Layer({ dots, ground, tone }: { dots: Dot[]; ground: number; tone: string }) {
  return (
    <svg className={`${styles.layer} ${motion.sceneDrift} ${tone}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {dots.map(({ x, y, r }) => <circle key={`${x}:${y}`} cx={x} cy={y} r={r} />)}
      <rect x={-40} y={ground} width={WIDTH + 80} height={HEIGHT} />
    </svg>
  );
}

export function NightScene() {
  return (
    <div className={styles.scene} aria-hidden="true">
      <div className={`${styles.dawn} ${motion.sceneDawn}`} />
      <svg className={`${styles.layer} ${styles.stars} ${motion.sceneDrift}`} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMin slice">
        {STARS.map(({ x, y, r }) => <circle key={`${x}:${y}`} cx={x} cy={y} r={r} />)}
      </svg>
      <div className={`${styles.moon} ${motion.sceneDrift}`} />
      <Layer dots={FAR} ground={650} tone={styles.far!} />
      <Layer dots={MID} ground={740} tone={styles.mid!} />
      <Layer dots={NEAR} ground={880} tone={styles.near!} />
    </div>
  );
}
