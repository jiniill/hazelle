import type { ReactNode } from 'react';
import styles from './Columns.module.css';

export function Columns({ min = 'tile', children }: { min?: 'tile' | 'wide' | 'panel'; children: ReactNode }) {
  return <div className={`${styles.columns} ${styles[min]}`}>{children}</div>;
}
