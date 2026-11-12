import type { ReactNode } from 'react';
import styles from './Intro.module.css';

// story: a page's opening sentence under its NavBar, which already holds the page's heading, and a quieter line under it.
export function Intro({ title, children, variant = 'title' }: { title: string; children?: ReactNode; variant?: 'title' | 'story' }) {
  const story = variant === 'story';
  const Title = story ? 'p' : 'h1';
  return (
    <div className={story ? `${styles.intro} ${styles.story}` : styles.intro}>
      <Title className={styles.title}>{title}</Title>
      {children && <p className={styles.lead}>{children}</p>}
    </div>
  );
}
