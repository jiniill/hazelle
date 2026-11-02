import styles from './Figure.module.css';

export function Figure({ src, alt }: { src: string; alt: string }) {
  return <img className={styles.figure} src={src} alt={alt} loading="lazy" />;
}
