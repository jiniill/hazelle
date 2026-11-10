import { createContext, useContext, type ReactNode } from 'react';
import styles from './ListDetail.module.css';

const PaneContext = createContext<'list' | 'detail' | null>(null);

// Which pane of a ListDetail a screen is in, or null on a page of its own.
export const usePane = () => useContext(PaneContext);

// The panes scroll independently and use pane-scale screens.
export function ListDetail({ list, detail }: { list: ReactNode; detail: ReactNode | null }) {
  return (
    <div className={styles.split}>
      <div className={styles.listPane}>
        <PaneContext.Provider value="list">{list}</PaneContext.Provider>
      </div>
      {detail !== null && (
        <div className={styles.detailPane}>
          <PaneContext.Provider value="detail">{detail}</PaneContext.Provider>
        </div>
      )}
    </div>
  );
}
