import { Eye, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import type { Way } from './Demo';
import { appears, Feed, Figure, join, Line, Message, Picture, pressed, top, Unfold, when, type Lines } from './DemoParts';
import styles from './PictureDemos.module.css';

// A story's text, line by line.
function Prose({ lines }: { lines: Lines }) {
  return (
    <span className={styles.prose}>
      {lines.map((width, line) => (
        <Line key={line} width={width} />
      ))}
    </span>
  );
}

// A reply's two paragraphs in a wide window's story column, and what stands where the first ends.
function Column({ motion, children }: { motion?: string | false; children?: ReactNode }) {
  return (
    <span className={join(styles.column, motion)}>
      <Prose lines={[94, 88, 52]} />
      <span className={styles.paragraphEnd}>{children}</span>
      <Prose lines={[92, 80, 66]} />
    </span>
  );
}

// way 0 covers a picture until it is tapped open; way 1 shows it.
export function HidePicturesDemo({ way }: { way: Way }) {
  return (
    <span>
      <Feed motion={top}>
        <Message lines={[92, 70]}>
          <span className={styles.framed}>
            <Picture ratio={2.2} motion={styles.full} />
            {way === 0 && (
              <span className={styles.veil}>
                <span className={join(styles.open, pressed)} style={when(0.4)}>
                  이미지 보기
                </span>
              </span>
            )}
          </span>
        </Message>
      </Feed>
    </span>
  );
}

// The reading width, and the most a picture takes of it otherwise (the dashed lines).
export function WideFillDemo({ way }: { way: Way }) {
  return (
    <span className={styles.reading}>
      <span className={styles.widest} />
      <Prose lines={[94, 60]} />
      <Picture ratio={3.2} motion={way === 0 ? styles.fills : styles.capped} />
      <Prose lines={[90, 72]} />
    </span>
  );
}

// A wide window, and an illustration of the first paragraph made after the reply: way 0 opens room for it right after
// the paragraph; way 1 stands it beside, level with the same place.
export function InlineIllustrationsDemo({ way }: { way: Way }) {
  return way === 0 ? (
    <span>
      <Column>
        <Unfold at={0.34}>
          <span className={styles.inline}>
            <Picture ratio={2.6} motion={styles.full} />
          </span>
        </Unfold>
      </Column>
    </span>
  ) : (
    <span>
      <Column motion={styles.leftOfSide}>
        <Picture ratio={1.2} motion={join(styles.margin, appears)} at={0.34} />
      </Column>
    </span>
  );
}

// way 0 shows the pictures on the chat's right; way 1 on its left.
export function PictureSideDemo({ way }: { way: Way }) {
  return (
    <span>
      <Column motion={way === 0 ? styles.leftOfSide : styles.rightOfSide} />
      <span className={join(styles.side, way === 0 ? styles.right : styles.left)}>
        <Picture ratio={0.8} motion={join(styles.full, way === 0 ? styles.fromRight : styles.fromLeft)}>
          <Figure motion={styles.close} />
        </Picture>
      </span>
    </span>
  );
}

// The character's picture comes in large beside the chat, and the chat moves aside for it.
export function PortraitDemo() {
  return (
    <span>
      <Column motion={styles.besidePortrait} />
      <Picture ratio={0.7} motion={join(styles.portrait, styles.grows)}>
        <Figure motion={styles.closest} />
      </Picture>
    </span>
  );
}

// way 0 folds a long picture to its top, so the words after it are in view, and a tap opens the rest; way 1 shows it
// whole, and the words after it are a long scroll away.
export function FoldLongDemo({ way }: { way: Way }) {
  const long = <Picture ratio={0.5} motion={styles.tall} />;
  return (
    <span>
      <Feed motion={join(top, way === 1 && styles.readsOn)}>
        <Message lines={[92, 70]}>
          {way === 0 ? (
            <span className={join(styles.tapped, pressed)} style={when(0.5)}>
              <span className={styles.folded}>{long}</span>
            </span>
          ) : (
            long
          )}
          <Line width={88} />
          <Line width={64} />
        </Message>
      </Feed>
    </span>
  );
}

// A reply comes in, and a picture of it is made under it.
export function AutoIllustrateDemo() {
  return (
    <span>
      <Feed motion={top}>
        <Message lines={[94, 86, 62]} typing={0.04}>
          <Unfold at={0.32}>
            <span className={styles.framed}>
              <span className={styles.making}>
                <Icon icon={Sparkles} size="sm" />
              </span>
              <Picture ratio={2.6} motion={join(styles.full, styles.made)} />
            </span>
          </Unfold>
        </Message>
      </Feed>
    </span>
  );
}

// way 0 draws what the persona sees, the persona left out; way 1 draws the scene with the persona in it.
export function PovDemo({ way }: { way: Way }) {
  return (
    <span className={styles.shown}>
      <Picture ratio={1.9} motion={join(styles.scene, appears)} at={0.04}>
        {way === 1 && <Figure persona motion={appears} at={0.2} />}
        <Figure motion={join(way === 0 && styles.seen, appears)} at={0.2} />
      </Picture>
      <span className={styles.legend}>
        {way === 0 ? <Icon icon={Eye} size="sm" /> : <span className={styles.persona} />}
        {way === 0 ? '1인칭 시점' : '3인칭 시점'}
      </span>
    </span>
  );
}

// way 0 draws the picture's place as a page of panels, read one after another; way 1 as one picture.
export function ComicDemo({ way }: { way: Way }) {
  return (
    <span className={styles.shown}>
      {way === 0 ? (
        <span className={styles.page}>
          <Panel at={0.06} ratio={2.6} talks>
            <Figure />
            <Figure />
          </Panel>
          <Panel at={0.22} ratio={1.3}>
            <Figure motion={styles.close} />
          </Panel>
          <Panel at={0.38} ratio={1.3} talks>
            <Figure />
          </Panel>
        </span>
      ) : (
        <Picture ratio={1.3} motion={join(styles.single, appears)} at={0.06}>
          <Figure />
          <Figure />
        </Picture>
      )}
    </span>
  );
}

// talks: a speech bubble over it.
function Panel({ at, ratio, talks = false, children }: { at: number; ratio: number; talks?: boolean; children: ReactNode }) {
  return (
    <span className={join(styles.panel, appears)} style={when(at)}>
      <Picture ratio={ratio} motion={styles.full}>
        {children}
      </Picture>
      {talks && <span className={styles.bubble} />}
    </span>
  );
}
