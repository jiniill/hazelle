import styles from './Figure.module.css';

export function Figure({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className={styles.frame}>
      <img className={styles.figure} src={src} alt={alt} loading="lazy" />
      <figcaption className={styles.caption}>{caption}</figcaption>
    </figure>
  );
}
