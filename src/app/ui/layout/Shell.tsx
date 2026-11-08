import { createContext, useRef, type ReactNode } from 'react';
import { useLayer } from '../overlays/layers';
import styles from './Shell.module.css';

// Read by Screen: a screen in the window takes the window's desktop scale.
export const InWindow = createContext(false);

type Layer = { label: string; behind: ReactNode; onClose: () => void };

// layer: a layer such as 설정 stands over the page it was opened from, which stays as it was, inert. Every screen in
// it begins at one top-left corner, so pages of different widths do not move it as the sidebar is walked.
export function Shell({ side, layer, children }: { side: ReactNode; layer?: Layer; children: ReactNode }) {
  if (!layer) {
    return (
      <div className={styles.shell}>
        {side}
        <div className={styles.main}>{children}</div>
      </div>
    );
  }
  return (
    <LayerWindow {...layer} side={side}>
      {children}
    </LayerWindow>
  );
}

// Esc joins the layer stack, so a menu open over the page closes first.
function LayerWindow({ label, behind, onClose, side, children }: Layer & { side: ReactNode; children: ReactNode }) {
  const scrim = useRef<HTMLDivElement>(null);
  useLayer(true, { outside: (target) => target === scrim.current, close: onClose });
  return (
    <>
      <div className={styles.behind} inert>
        {behind}
      </div>
      <div ref={scrim} className={styles.scrim}>
        <div role="dialog" aria-modal="true" aria-label={label} className={styles.window}>
          {side}
          <div className={`${styles.main} ${styles.start}`}>
            <InWindow.Provider value>{children}</InWindow.Provider>
          </div>
        </div>
      </div>
    </>
  );
}
