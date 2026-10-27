import type { LucideIcon } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../foundation/Icon';
import styles from './SelectionButton.module.css';

// Where a selection ends in the view: x where it stops, and the top and bottom of its last line.
export type SelectionEnd = { x: number; top: number; bottom: number };

// Kept from the view's sides, so the button never runs off them.
const EDGE = 48;

export function SelectionButton({ icon, label, at, onPress }: { icon: LucideIcon; label: string; at: SelectionEnd; onPress: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const above = at.bottom > window.innerHeight * 0.75;
  useLayoutEffect(() => {
    const element = button.current!;
    element.style.setProperty('--selection-x', `${Math.min(Math.max(at.x, EDGE), window.innerWidth - EDGE)}px`);
    element.style.setProperty('--selection-y', `${above ? at.top : at.bottom}px`);
  }, [at.x, at.top, at.bottom, above]);
  return createPortal(
    <button
      ref={button}
      type="button"
      className={styles.button}
      data-above={above || undefined}
      // A press elsewhere ends the selection before the click; this one keeps it.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      <Icon icon={icon} size="sm" />
      {label}
    </button>,
    document.body,
  );
}
