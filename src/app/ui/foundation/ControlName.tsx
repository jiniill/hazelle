import styles from './ControlName.module.css';

// A Hazelle control's name inside running text, drawn as the button it names.
export function ControlName({ children }: { children: string }) {
  return <span className={styles.name}>{children}</span>;
}
