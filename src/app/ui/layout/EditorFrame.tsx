import { useLayoutEffect, useRef, type ReactNode } from 'react';
import styles from './EditorFrame.module.css';
import { useNarrowerThan } from '../foundation/useNarrowerThan';

// split: the outline beside the open part; drill: the outline, or one part of it with a back to it.
export type EditorLayout = 'split' | 'drill';

// Decided by the room the editor is given (beside the sidebar and its chat list, or a whole phone), not the screen's
// width. Nothing renders before the first measure, so no editor mounts in the other layout.
export function EditorRoom({ children }: { children: (layout: EditorLayout) => ReactNode }) {
  const [room, narrower] = useNarrowerThan<HTMLDivElement>('--editor-split');
  return <div ref={room}>{narrower !== undefined && children(narrower ? 'drill' : 'split')}</div>;
}

type Props = {
  top: ReactNode;
  side: ReactNode;
  // The page scrolls back to its top when this changes, such as when another part is opened.
  page?: string;
  children: ReactNode;
};

export function EditorFrame({ top, side, page, children }: Props) {
  const main = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [page]);
  return (
    <main className={styles.frame}>
      <header className={styles.top}>{top}</header>
      <div className={styles.body}>
        <nav className={styles.side} aria-label="개요">
          {side}
        </nav>
        <div ref={main} className={styles.main}>
          <div className={styles.page}>{children}</div>
        </div>
      </div>
    </main>
  );
}
