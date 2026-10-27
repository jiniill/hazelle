import { Maximize2, Minimize2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { usePanelCovers } from '../foundation/media';
import { useLayer } from '../overlays/layers';
import { NavBar, type NavBarProps } from './NavBar';
import styles from './SidePanel.module.css';

// page resets scroll; expandable preserves the underlying page; fill delegates scrolling to its child.
type Props = { title: string; subtitle?: string; nav?: NavBarProps; page?: string; actions?: ReactNode; expandable?: boolean; fill?: boolean; onClose: () => void; children: ReactNode };

// Overlay panels close on outside/Esc; beside panels leave Esc to page actions such as stop reply (user, 2026-10-02).
export function SidePanel({ title, subtitle, nav, page, actions, expandable = false, fill = false, onClose, children }: Props) {
  const covers = usePanelCovers();
  const [expanded, setExpanded] = useState(false);
  const widens = expandable && !covers;
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const latest = useRef(onClose);
  latest.current = onClose;
  useLayer(covers, {
    // A toast lies over the page too and is no part of it.
    outside: (target) => !panel.current?.contains(target) && !(target instanceof Element ? target : target.parentElement)?.closest('[role="status"], [role="alert"]'),
    // Close after click only if still the same panel: opener/another-panel actions may already replace it.
    // Drags have no click and must not leave a stale pending outside press.
    close: (refocus) => {
      if (refocus) return onClose();
      const done = () => panel.current && latest.current();
      document.addEventListener('click', done, { once: true });
      document.addEventListener('pointerdown', () => document.removeEventListener('click', done), { once: true });
    },
  });
  useLayoutEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [page]);
  return (
    <aside ref={panel} className={widens && expanded ? `${styles.panel} ${styles.expanded}` : styles.panel} aria-label={title}>
      <div className={styles.head}>
        {nav ? (
          <NavBar {...nav} line />
        ) : (
          <div className={styles.titles}>
            <h2 className={styles.title}>{title}</h2>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
        )}
        {actions}
        {widens && <IconButton icon={expanded ? Minimize2 : Maximize2} label={expanded ? '좁게 보기' : '넓게 보기'} size="sm" onClick={() => setExpanded(!expanded)} />}
        <IconButton icon={X} label={`${title} 닫기`} size="sm" onClick={onClose} />
      </div>
      <div ref={body} className={fill ? `${styles.body} ${styles.fill}` : styles.body}>
        {children}
      </div>
    </aside>
  );
}
