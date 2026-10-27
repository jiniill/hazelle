import { createContext, useContext, type ReactNode } from 'react';
import styles from './ListDetail.module.css';

const PaneContext = createContext<'list' | 'detail' | 'stack' | null>(null);

// Which pane of a ListDetail a screen is in, or null on a page of its own.
export const usePane = () => useContext(PaneContext);

// list panes scroll independently and use pane-scale screens; stack uses one scroll with list above detail.
export function ListDetail({ list, detail, variant = 'list' }: { list: ReactNode; detail: ReactNode | null; variant?: 'list' | 'stack' }) {
  return (
    <div className={variant === 'list' ? styles.split : `${styles.split} ${styles[variant]}`}>
      <div className={styles.listPane}>
        <PaneContext.Provider value="list">{list}</PaneContext.Provider>
      </div>
      {detail !== null && (
        <div className={styles.detailPane}>
          <PaneContext.Provider value={variant === 'list' ? 'detail' : variant}>{detail}</PaneContext.Provider>
        </div>
      )}
    </div>
  );
}
