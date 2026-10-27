import type { ReactNode } from 'react';
import { TitleField } from '../controls/TitleField';
import { MoreMenu } from '../overlays/MoreMenu';
import type { NavBarProps } from './NavBar';
import styles from './ItemSection.module.css';

type Props = {
  title: string;
  rename?: NavBarProps['rename'];
  note?: string;
  menu: { of: string; items: ReactNode };
  children: ReactNode;
};

export function ItemSection({ title, rename, note, menu, children }: Props) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.head}>
        <div className={styles.titles}>
          <h2 className={styles.title}>{rename ? <TitleField label={rename.label} value={title} placeholder={rename.placeholder} blank={rename.blank} onChange={rename.onChange} /> : title}</h2>
          {note && <span className={styles.note}>{note}</span>}
        </div>
        <MoreMenu of={menu.of}>{menu.items}</MoreMenu>
      </div>
      {children}
    </section>
  );
}
