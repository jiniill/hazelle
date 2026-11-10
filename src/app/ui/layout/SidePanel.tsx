import { Maximize2, Minimize2, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { classNames } from '../foundation/classNames';
import { useLeaves } from '../foundation/leave';
import { usePanelCovers } from '../foundation/media';
import { useFocusTrap, useLayer } from '../overlays/layers';
import { NavBar, type NavBarProps } from './NavBar';
import styles from './SidePanel.module.css';

// page resets scroll; expandable preserves the underlying page, and onExpand says whether the panel stands expanded
// over it (never where it covers the page); fill delegates scrolling to its child.
type Props = { title: string; description?: string; nav?: NavBarProps; page?: string; actions?: ReactNode; expandable?: boolean; onExpand?: (expanded: boolean) => void; fill?: boolean; onClose: () => void; children: ReactNode };

// A key aimed at a side panel or a dialog rather than the page under it: focus in one or, with focus nowhere, the pointer
// over a panel.
export function aimedAtPanel({ target }: KeyboardEvent): boolean {
  return target instanceof Element && target !== document.body ? !!target.closest('[data-side-panel], [role="dialog"]') : !!document.querySelector('[data-side-panel]:hover');
}

// Overlay panels close on outside/Esc; beside panels leave Esc to page actions such as stop reply (user, 2026-10-02).
export function SidePanel({ title, description, nav, page, actions, expandable = false, onExpand, fill = false, onClose, children }: Props) {
  const covers = usePanelCovers();
  const [expanded, setExpanded] = useState(false);
  const widens = expandable && !covers;
  const wide = widens && expanded;
  useLayoutEffect(() => {
    onExpand?.(wide);
  }, [onExpand, wide]);
  const body = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const leaving = useLeaves(panel);
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
    takesBack: true,
  });
  // Covering, its head's back is a step of its own: the browser's back leaves the open part, not the panel. Named by
  // where it goes, which differs between one level and the next where a title may not (a character's part and a script
  // in it share the character's name).
  useLayer(covers && nav?.onBack !== undefined, { outside: () => false, close: () => nav?.onBack?.(), takesBack: true, step: nav?.backLabel });
  // Covering, it holds the focus from itself; beside, the page keeps it.
  const trap = useFocusTrap(panel, covers);
  useLayoutEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [page]);
  return (
    <aside ref={covers ? leaving : panel} className={classNames(styles.panel, wide && styles.expanded, covers ? styles.covers : styles.beside)} aria-label={title} data-side-panel tabIndex={covers ? -1 : undefined} data-autofocus={covers || undefined} onKeyDown={trap}>
      <div className={styles.head}>
        {nav ? (
          <NavBar {...nav} line />
        ) : (
          <div className={styles.titles}>
            <h2 className={styles.title}>{title}</h2>
            {description && <p className={styles.subtitle}>{description}</p>}
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
