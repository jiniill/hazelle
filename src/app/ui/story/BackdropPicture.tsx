import styles from './BackdropPicture.module.css';

// A step of 배경 가림 or 배경 흐림.
export type Shade = 'none' | 'low' | 'mid' | 'high';
export const SHADE: Record<Shade, string> = { none: '없음', low: '약하게', mid: '보통', high: '강하게' };

const VEIL: Record<Shade, string> = { none: '', low: styles.veilLow, mid: styles.veilMid, high: styles.veilHigh };
const BLUR: Record<Shade, string> = { none: '', low: styles.blurLow, mid: styles.blurMid, high: styles.blurHigh };

// The character's background picture in ChatFrame's backdrop, under its StoryBackdrop: covering it, blurred, and veiled
// in the scheme's own background color, so a light look veils light.
export function BackdropPicture({ src, veil, blur }: { src: string; veil: Shade; blur: Shade }) {
  return (
    <div className={`${styles.picture} ${VEIL[veil]}`} aria-hidden>
      <div className={`${styles.image} ${BLUR[blur]}`} style={{ backgroundImage: `url("${src}")` }} />
    </div>
  );
}
