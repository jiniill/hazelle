import type { LucideIcon } from 'lucide-react';
import type { Ref } from 'react';
import { Icon } from '../foundation/Icon';
import styles from './ToolButton.module.css';

type Props = {
  icon: LucideIcon;
  label: string;
  detail?: string;
  // count: shown from 1. dot: the chat has its own.
  mark?: { kind: 'count'; count: number } | { kind: 'dot' };
  // expanded for one that opens something, pressed for one that is itself a switch.
  expanded?: boolean;
  pressed?: boolean;
  busy?: boolean;
  phone?: 'full' | 'icon';
  wide?: 'full' | 'icon';
  // One that opens a form from Menu takes popup and ref too; one that shows and hides a panel takes expanded alone.
  popup?: 'menu' | 'dialog';
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
};

export function ToolButton({ icon, label, detail, mark, busy = false, phone = 'full', wide = 'full', expanded, pressed, popup, ref, onClick }: Props) {
  const shown = mark?.kind === 'dot' || (mark?.kind === 'count' && mark.count > 0);
  return (
    <button
      ref={ref}
      type="button"
      className={[styles.tool, phone === 'icon' && styles.phoneIcon, wide === 'icon' && styles.wideIcon].filter(Boolean).join(' ')}
      title={label}
      aria-label={detail ? `${label}, ${detail}` : label}
      aria-haspopup={popup}
      aria-expanded={expanded}
      aria-pressed={pressed}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy ? <span className={styles.spinner} aria-hidden /> : <Icon icon={icon} size="sm" />}
      <span className={styles.label}>{label}</span>
      {shown &&
        (mark.kind === 'dot' ? (
          <span className={styles.dot} aria-hidden />
        ) : (
          <span className={styles.count} aria-hidden>
            {mark.count}
          </span>
        ))}
    </button>
  );
}
