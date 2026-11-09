import { ChevronLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { ButtonSlot } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { TitleField } from '../controls/TitleField';
import { Hint, type Help } from '../overlays/Hint';
import { MoreMenu } from '../overlays/MoreMenu';
import { usePane } from './ListDetail';
import styles from './NavBar.module.css';

type Back = { backLabel: string; onBack: () => void; close?: boolean } | { backLabel?: never; onBack?: never; close?: never };
export type NavBarProps = {
  title: string;
  rename?: { label: string; placeholder: string; blank?: string; onChange: (title: string) => void };
  subtitle?: ReactNode;
  // What the page's thing is, behind an ⓘ by the title.
  help?: Help;
  status?: string;
  actions?: ReactNode;
  menu?: { of: string; items: ReactNode };
  // Side-panel heads must align with chat header height; truncate title/subtitle to one line each (user, 2026-10-12).
  line?: boolean;
} & Back;

export function NavBar({ title, rename, subtitle, help, status, backLabel, onBack, close = false, actions, menu, line = false }: NavBarProps) {
  const pane = usePane();
  const heading = rename ? `${styles.title} ${styles.field}` : line ? styles.title : `${styles.title} ${styles.words}`;
  return (
    <div className={line ? `${styles.bar} ${styles.line}` : styles.bar}>
      {onBack && pane !== 'detail' && (
        <span className={styles.back}>
          <IconButton icon={close ? X : ChevronLeft} label={backLabel} onClick={onBack} />
        </span>
      )}
      <div className={styles.titles}>
        <span className={styles.name}>
          <h1 className={heading} title={rename ? undefined : title}>{rename ? <TitleField label={rename.label} value={title} placeholder={rename.placeholder} blank={rename.blank} onChange={rename.onChange} place={line ? 'line' : 'page'} /> : title}</h1>
          {help && <Hint label={title}>{help}</Hint>}
        </span>
        {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
      </div>
      {status !== undefined && (
        <span className={`${styles.band} ${styles.status}`} role="status">
          {status}
        </span>
      )}
      {actions && (
        <span className={`${styles.band} ${styles.actions}`}>
          <ButtonSlot value="sm">{actions}</ButtonSlot>
        </span>
      )}
      {menu && (
        <span className={styles.band}>
          <MoreMenu of={menu.of}>{menu.items}</MoreMenu>
        </span>
      )}
    </div>
  );
}
