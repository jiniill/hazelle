import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './Item.module.css';

type Props = {
  density: 'chip' | 'compact' | 'regular' | 'tall';
  scheme: 'side' | 'list' | 'tab';
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  preview?: ReactNode;
  trailing?: ReactNode;
  // Words in trailing move under the title when they do not fit beside it, so the title keeps its width.
  trailingWraps?: boolean;
  // 'page': the item open beside its list (ListDetail).
  current?: boolean | 'page';
  pressed?: boolean;
  expanded?: boolean;
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';
  checked?: boolean;
  tone?: 'plain' | 'muted' | 'warn';
  disabled?: boolean;
  // With onClick the whole row is one button, so trailing must not hold a control then.
  onClick?: () => void;
};

// Visual current/pressed state must derive from ARIA so it cannot disagree with accessibility state.
export function Item({ density, scheme, leading, title, meta, preview, trailing, trailingWraps = false, current, pressed, expanded, role, checked, tone = 'plain', disabled, onClick }: Props) {
  const branch = expanded !== undefined;
  const line = density === 'tall' && meta === undefined && preview === undefined;
  const classes = [styles.item, styles[density], styles[scheme], line && styles.line, onClick && styles.pressable, branch && styles.branch, tone !== 'plain' && styles[tone]].filter(Boolean).join(' ');
  const clip = density === 'regular';
  const titleClass = [styles.title, density === 'regular' && styles.rowTitle, density === 'tall' && styles.tallTitle, clip && styles.clip].filter(Boolean).join(' ');
  const previewClass = density === 'compact' ? styles.sub : clip ? `${styles.preview} ${styles.clip}` : styles.preview;
  // meta and preview are drawn even when empty: an empty time still keeps its gap beside the title.
  const text = (
    <span className={styles.text}>
      <span className={styles.head}>
        <span className={titleClass}>{title}</span>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </span>
      {preview !== undefined && <span className={previewClass}>{preview}</span>}
    </span>
  );
  const content = (
    <>
      {branch && <Icon icon={expanded ? ChevronDown : ChevronRight} size="sm" />}
      {leading}
      {trailingWraps ? (
        <span className={styles.wraps}>
          {text}
          {trailing}
        </span>
      ) : (
        <>
          {text}
          {trailing}
        </>
      )}
    </>
  );
  if (!onClick) return <div className={classes}>{content}</div>;
  return (
    <button type="button" className={classes} role={role} aria-checked={checked} aria-current={current || undefined} aria-pressed={pressed} aria-expanded={expanded} disabled={disabled} onClick={onClick}>
      {content}
    </button>
  );
}
