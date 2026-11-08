import { createContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLayer } from '../overlays/layers';
import styles from './Shell.module.css';

// Read by Screen: a screen in the window takes the window's desktop scale.
export const InWindow = createContext(false);

// held: a LayerWindow stands over the page, which stays mounted where it was, inert and at its scroll.
export function Shell({ side, held = false, children }: { side: ReactNode; held?: boolean; children: ReactNode }) {
  useHeldScroll(held);
  return (
    <div className={held ? `${styles.shell} ${styles.held}` : styles.shell} inert={held}>
      {side}
      <div className={styles.main}>{children}</div>
    </div>
  );
}

// Opening or walking a layer navigates, which scrolls to the top: the page under it is put back where it was read,
// and left there when the layer closes.
export function useHeldScroll(held: boolean) {
  const read = useRef(0);
  useEffect(() => {
    if (held) return;
    const keep = () => {
      read.current = window.scrollY;
    };
    keep();
    window.addEventListener('scroll', keep, { passive: true });
    return () => window.removeEventListener('scroll', keep);
  }, [held]);
  const was = useRef(held);
  useLayoutEffect(() => {
    if ((held || was.current) && window.scrollY !== read.current) window.scrollTo(0, read.current);
    was.current = held;
  });
}

type Layer = { label: string; side: ReactNode; onClose: () => void; children: ReactNode };

// A layer such as 설정, over the held Shell it was opened from. Every screen in it begins at one top-left corner, so
// pages of different widths do not move it as the sidebar is walked. Esc joins the layer stack, so a menu open over
// the page closes first.
export function LayerWindow({ label, side, onClose, children }: Layer) {
  const scrim = useRef<HTMLDivElement>(null);
  useLayer(true, { outside: (target) => target === scrim.current, close: onClose });
  return (
    <div ref={scrim} className={styles.scrim}>
      <div role="dialog" aria-modal="true" aria-label={label} className={styles.window}>
        {side}
        <div className={`${styles.main} ${styles.start}`}>
          <InWindow.Provider value>{children}</InWindow.Provider>
        </div>
      </div>
    </div>
  );
}
