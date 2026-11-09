import { useContext, type FormEvent, type ReactNode } from 'react';
import { usePane } from './ListDetail';
import { InWindow } from './Shell';
import styles from './Screen.module.css';
import { classNames } from '../foundation/classNames';

type Props = {
  top?: ReactNode;
  align?: 'start' | 'center';
  // page: 설정's pages, which use the column beside the settings sidebar.
  width?: 'narrow' | 'form' | 'wide' | 'page';
  actions?: ReactNode;
  // What closes the page after its actions, such as the license notice.
  foot?: ReactNode;
  // One child takes the rest of the window's height and scrolls itself.
  fill?: boolean;
  // What heads the page above both the body and its aside, such as a guide's title.
  lead?: ReactNode;
  // A column beside the body once the screen is wide enough for both; above the body when it is not.
  aside?: ReactNode;
  // The aside stays in view as the body scrolls, such as a preview of what the body changes.
  stickyAside?: boolean;
  // sm: a narrow column, such as a page's contents.
  asideSize?: 'md' | 'sm';
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

export function Screen({ top, lead, align = 'start', width = 'narrow', actions, foot, fill = false, aside, stickyAside = false, asideSize = 'md', onSubmit, children }: Props) {
  const pane = usePane();
  const windowed = useContext(InWindow);
  // A page has one main landmark; beside a list, a screen is one section of it.
  const Root = pane ? 'section' : 'main';
  const beside = Boolean(aside);
  const content = align === 'center' ? `${styles.content} ${styles.center}` : styles.content;
  const body = <div className={styles.body}>{children}</div>;
  const inner = (
    <>
      {lead}
      {beside ? (
        // A container query measures an ancestor, never the element it styles: the frame is what the columns measure.
        <div className={styles.frame}>
          <div className={styles.columns}>
            <div className={stickyAside ? `${styles.aside} ${styles.sticky}` : styles.aside}>{aside}</div>
            <div className={styles.main}>{body}</div>
          </div>
        </div>
      ) : (
        body
      )}
      {actions && <div className={styles.actions}>{actions}</div>}
    </>
  );
  return (
    <Root className={classNames(styles.screen, pane && styles.pane, fill && styles.fill, align === 'center' && styles.centered, width !== 'narrow' && styles[width], beside && styles.split, beside && asideSize === 'sm' && styles.asideSm, windowed && styles.windowed)}>
      {top && <header className={styles.top}>{top}</header>}
      {onSubmit ? (
        <form className={content} onSubmit={onSubmit} noValidate>
          {inner}
        </form>
      ) : (
        <div className={content}>{inner}</div>
      )}
      {foot && <footer>{foot}</footer>}
    </Root>
  );
}
