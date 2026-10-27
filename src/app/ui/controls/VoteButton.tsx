import { ThumbsUp } from 'lucide-react';
import styles from './VoteButton.module.css';

type Props = {
  // What the button is named by, the count in it (such as 추천 6).
  label: string;
  // Shown before the count in a row, such as 추천: the post's one reaction says what it is.
  word?: string;
  count: string;
  pressed: boolean;
  // column: a feed's column beside a post; row: under a post read whole.
  layout?: 'column' | 'row';
  onClick: () => void;
};

export function VoteButton({ label, word, count, pressed, layout = 'row', onClick }: Props) {
  return (
    <button type="button" className={`${styles.vote} ${styles[layout]}`} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      <ThumbsUp className={styles.icon} aria-hidden />
      <span className={styles.count}>{layout === 'row' && word ? `${word} ${count}` : count}</span>
    </button>
  );
}
