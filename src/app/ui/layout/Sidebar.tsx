import { PanelLeft, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Brand } from '../foundation/Brand';
import { Divider } from '../foundation/Divider';
import { useLayer } from '../overlays/layers';
import styles from './Sidebar.module.css';

type Props = {
  page?: boolean;
  actions: ReactNode;
  children: ReactNode;
  // Beside the brand, so only a page shows it.
  corner?: ReactNode;
};

export function Sidebar({ page = false, actions, children, corner }: Props) {
  return (
    <aside className={page ? `${styles.sidebar} ${styles.page}` : styles.sidebar} aria-label="캐릭터 목록">
      {/* Beside the rail, whose mark is the brand, the panel starts with its own rows. */}
      {page && (
        <div className={styles.head}>
          <Brand />
          {corner}
        </div>
      )}
      <div className={styles.actions}>{actions}</div>
      <div className={styles.list}>{children}</div>
    </aside>
  );
}

// Esc joins the layer stack, so a menu open over the page closes first.
// seek: changes with the current row, which then comes into view: on opening, on going back, when a search gives way to the list.
export function LayerSidebar({ title, onClose, search, seek, children }: { title: string; onClose: () => void; search?: ReactNode; seek?: string; children: ReactNode }) {
  useLayer(true, { outside: () => false, close: onClose });
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' });
  }, [seek]);
  return (
    <aside className={styles.sidebar} aria-label={title}>
      <div className={styles.head}>
        <h2 className={styles.title}>{title}</h2>
        <IconButton icon={X} label={`${title} 닫기`} size="sm" onClick={onClose} />
      </div>
      {search}
      <nav ref={list} className={styles.list} aria-label={title}>
        {children}
      </nav>
    </aside>
  );
}

type RailProps = {
  // Only while there is a panel beside the rail to fold.
  fold?: { open: boolean; onToggle: () => void };
  // What acts on the library, above the faces; places: the ways to other parts of the app, pinned under them.
  actions: ReactNode;
  places: ReactNode;
  children: ReactNode;
};

// Keep fold last so actions never move; split bottom places into two groups (user, 2026-10-20).
// Brand mark is not home navigation: use the framed action button (user, 2026-10-12).
export function Rail({ fold, actions, places, children }: RailProps) {
  return (
    <aside className={styles.rail} aria-label="캐릭터 바로가기">
      <div className={styles.mark}>
        <Brand variant="mark" />
      </div>
      {actions}
      {fold && <IconButton icon={PanelLeft} label={fold.open ? '사이드바 접기' : '사이드바 펼치기'} framed onClick={fold.onToggle} />}
      <Divider variant="rail" />
      <div className={styles.railList}>{children}</div>
      <Divider variant="rail" />
      <div className={styles.railPlaces}>{places}</div>
    </aside>
  );
}

type FaceButtonProps = { label: string; current?: boolean; dot?: boolean; onClick: () => void; children: ReactNode };

export function FaceButton({ label, current = false, dot, onClick, children }: FaceButtonProps) {
  return (
    <button type="button" className={current ? `${styles.faceButton} ${styles.current}` : styles.faceButton} aria-label={label} title={label} aria-current={current || undefined} onClick={onClick}>
      {children}
      {dot && <span className={styles.dot} />}
    </button>
  );
}
