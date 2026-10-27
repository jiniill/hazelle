import { Info } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, ButtonSlot } from '../controls/Button';
import { Icon } from '../foundation/Icon';
import { useHover } from '../foundation/media';
import { useAnchored, useLayer } from './layers';
import { useMenuClose } from './Menu';
import styles from './Hint.module.css';

// open: a door to the place the text names. The kit knows no routes, so the caller says what it does.
export type Help = string | { text: string; open: { label: string; onClick: () => void } };

// Long enough that a pointer passing over a column of ⓘ opens none of them.
const PEEK_DELAY = 300;
// Long enough for a pointer to cross from the ⓘ to its bubble.
const CROSS_DELAY = 150;

export function Hint({ label, children }: { label: string; children: Help }) {
  const hover = useHover();
  const [state, setState] = useState<'closed' | 'peek' | 'pinned'>('closed');
  const timer = useRef(0);
  const box = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const door = useRef<HTMLButtonElement>(null);
  const closeMenu = useMenuClose();
  const id = useId();
  const { text, open } = typeof children === 'string' ? { text: children, open: undefined } : children;
  const button = () => box.current?.querySelector('button');

  // Register peeks as layers too: otherwise clicking a door inside a menu closes/unmounts it before its click.
  useLayer(state !== 'closed', {
    outside: (target) => !box.current?.contains(target) && !bubble.current?.contains(target),
    close: (refocus) => {
      const pinned = state === 'pinned';
      setState('closed');
      if (refocus && pinned) button()?.focus();
    },
  });
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useAnchored(state !== 'closed', bubble, box, () => setState('closed'));

  // The bubble sits at the end of the body, out of the Tab order after the ⓘ, so a pinned door takes the focus.
  useEffect(() => {
    if (state === 'pinned') door.current?.focus();
  }, [state]);

  const later = (next: () => void, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(next, delay);
  };
  const peek = () => later(() => setState((now) => (now === 'closed' ? 'peek' : now)), PEEK_DELAY);
  const stay = () => window.clearTimeout(timer.current);
  const leave = () => later(() => setState((now) => (now === 'peek' ? 'closed' : now)), CROSS_DELAY);

  function go() {
    window.clearTimeout(timer.current);
    setState('closed');
    closeMenu();
    open!.onClick();
  }

  // The focus goes back to the ⓘ, whose next Tab goes on through the page; stopped, so a dialog's focus trap does not
  // take this Tab as its own.
  function tab(event: KeyboardEvent) {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    setState('closed');
    button()?.focus();
  }

  return (
    <span ref={box} className={styles.hint} onPointerEnter={hover ? peek : undefined} onPointerLeave={hover ? leave : undefined}>
      <button
        type="button"
        className={styles.button}
        aria-label={`${label} 설명`}
        aria-expanded={state !== 'closed'}
        aria-controls={id}
        onClick={() => {
          window.clearTimeout(timer.current);
          setState((now) => (now === 'pinned' ? 'closed' : 'pinned'));
        }}
      >
        <Icon icon={Info} size="sm" />
      </button>
      {state !== 'closed' &&
        createPortal(
          <span
            ref={bubble}
            id={id}
            role="note"
            className={styles.bubble}
            onPointerEnter={hover ? stay : undefined}
            onPointerLeave={hover ? leave : undefined}
          >
            {text}
            {open && (
              <span className={styles.door} onKeyDown={tab}>
                <ButtonSlot value={null}>
                  <Button ref={door} variant="link" size="xs" onClick={go}>
                    {open.label}
                  </Button>
                </ButtonSlot>
              </span>
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}
