import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHover } from '../foundation/media';
import { useAnchored, useLayer } from '../overlays/layers';
import styles from './MascotRemark.module.css';

type Props = {
  // The mascot's round face on the mark, and the picture of the face it picked, shown in the card.
  face: string;
  picture: string;
  name: string;
  line: string;
  // Not yet read: the mark's dots sway until the card first opens, which calls onSeen. Nothing opens it by itself.
  fresh: boolean;
  onSeen: () => void;
};

// Long enough that a pointer passing along a message's tools opens nothing.
const REST_DELAY = 200;

export function MascotRemark({ face, picture, name, line, fresh, onSeen }: Props) {
  const hover = useHover();
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const mark = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const id = useId();

  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };
  const rest = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(show, REST_DELAY);
  };

  // Card click closes it. On Esc retain mark focus without calling focus(): focus-visible would reopen it.
  useLayer(open, { outside: (target) => !mark.current?.contains(target), close });
  useAnchored(open, card, mark, close);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (open && fresh) onSeen();
  }, [open]);

  return (
    <>
      <button
        ref={mark}
        type="button"
        className={styles.mark}
        aria-label={`${name}의 한마디`}
        aria-expanded={open}
        aria-controls={id}
        onPointerEnter={hover ? rest : undefined}
        onPointerLeave={hover ? close : undefined}
        // Only a key's focus opens it: a tap focuses the mark too, and its click would shut what the focus opened.
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) show();
        }}
        onBlur={close}
        onClick={hover ? show : () => setOpen((now) => !now)}
      >
        <img className={styles.face} src={face} alt="" />
        <span className={fresh ? `${styles.dots} ${styles.fresh}` : styles.dots} aria-hidden>
          ···
        </span>
      </button>
      {open &&
        createPortal(
          <div ref={card} id={id} role="note" className={styles.card}>
            <div className={styles.words}>
              <span className={styles.name}>{name}</span>
              <p className={styles.line}>{line}</p>
            </div>
            <div className={styles.frame}>
              <img className={styles.picture} src={picture} alt="" />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
