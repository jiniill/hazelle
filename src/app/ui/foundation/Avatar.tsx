import type { LucideIcon } from 'lucide-react';
import styles from './Avatar.module.css';
import { Icon } from './Icon';
import { useVeil } from './veil';

type Props = {
  // A name stands in as its first letter, a plain one tinted by the name.
  face: string | LucideIcon;
  // A character's picture. face stands in while there is none.
  image?: string | null;
  // story: the speaker's beside a message, md's unless the theme says otherwise (theme.ts speakers). fill: the whole
  // of the frame it stands in, which sets the letter's size (CardGrid's pictures).
  size?: 'sm' | 'md' | 'story' | 'rail' | 'lg' | 'fill';
  // accent: the operator's face on the board.
  tone?: 'plain' | 'you' | 'accent';
};

const TINTS = [styles.tint1, styles.tint2, styles.tint3, styles.tint4, styles.tint5];
const tint = (name: string) => TINTS[[...name].reduce((hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0, 0) % TINTS.length];

export function Avatar({ face, image, size = 'md', tone = 'plain' }: Props) {
  const veil = useVeil();
  const pictured = image && !veil;
  const look = !pictured && typeof face === 'string' && tone === 'plain' ? `${styles.letter} ${tint(face)}` : styles[tone];
  return (
    <span className={`${styles.avatar} ${styles[size]} ${look}`} aria-hidden>
      {pictured ? <img className={styles.image} src={image} alt="" /> : typeof face === 'string' ? [...face][0] : <Icon icon={face} />}
    </span>
  );
}
