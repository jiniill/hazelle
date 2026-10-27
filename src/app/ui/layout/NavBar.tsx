import { ChevronLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ButtonSlot } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { TitleField } from '../controls/TitleField';
import { MoreMenu } from '../overlays/MoreMenu';
import { usePane } from './ListDetail';
import styles from './NavBar.module.css';

type Back = { backLabel: string; onBack: () => void; close?: boolean } | { backLabel?: never; onBack?: never; close?: never };
export type NavBarProps = {
  title: string;
  rename?: { label: string; placeholder: string; blank?: string; onChange: (title: string) => void };
  subtitle?: ReactNode;
  status?: string;
  actions?: ReactNode;
  menu?: { of: string; items: ReactNode };
  // Side-panel heads must align with chat header height; truncate title/subtitle to one line each (user, 2026-10-12).
  line?: boolean;
} & Back;

export function NavBar({ title, rename, subtitle, status, backLabel, onBack, close = false, actions, menu, line = false }: NavBarProps) {
  const pane = usePane();
  return (
    <div className={line ? `${styles.bar} ${styles.line}` : styles.bar}>
      {onBack && pane !== 'detail' && (
        <span className={styles.back}>
          <IconButton icon={close ? X : ChevronLeft} label={backLabel} onClick={onBack} />
        </span>
      )}
      <div className={styles.titles}>
        <h1 className={styles.title}>{rename ? <TitleField label={rename.label} value={title} placeholder={rename.placeholder} blank={rename.blank} onChange={rename.onChange} place={line ? 'line' : 'page'} /> : title}</h1>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      {status !== undefined && (
        <span className={styles.status} role="status">
          {status}
        </span>
      )}
      {actions && (
        <span className={styles.actions}>
          <ButtonSlot value="sm">{actions}</ButtonSlot>
        </span>
      )}
      {menu && <MoreMenu of={menu.of}>{menu.items}</MoreMenu>}
    </div>
  );
}
