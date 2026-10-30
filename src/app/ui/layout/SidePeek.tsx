import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { useLayer } from '../overlays/layers';
import styles from './SidePeek.module.css';

type Props = {
  label: string;
  // Held open by a key or a tap; pointing at the tab shows it only while the pointer stays.
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: ReactNode;
  children: ReactNode;
};

export function SidePeeks({ children }: { children: ReactNode }) {
  return <div className={styles.peeks}>{children}</div>;
}

// Held open, it has its own close: on a phone the drawer covers nearly all the story, and what is left outside it
// is the composer, whose press raises the keyboard.
export function SidePeek({ label, open, onOpenChange, actions, children }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useLayer(open, {
    outside: (target) => !root.current?.contains(target),
    close: () => onOpenChange(false),
    takesBack: true,
  });

  return (
    <div ref={root} className={open ? `${styles.peek} ${styles.open}` : styles.peek}>
      <button type="button" className={styles.tab} aria-expanded={open} onClick={() => onOpenChange(!open)}>
        {label}
      </button>
      <aside className={styles.drawer} aria-label={label}>
        <div className={styles.head}>
          <h2 className={styles.title}>{label}</h2>
          {actions}
          {open && <IconButton icon={X} size="sm" label={`${label} 닫기`} onClick={() => onOpenChange(false)} />}
        </div>
        <div className={styles.body}>{children}</div>
      </aside>
    </div>
  );
}
