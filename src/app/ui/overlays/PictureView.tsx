import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../controls/IconButton';
import styles from './PictureView.module.css';
import { useFocusTrap, useLayer } from './layers';

// The versions of one picture's place, browsed as its stepper browses them.
export type Pages = { at: number; count: number; onStep: (by: -1 | 1) => void };

type Props = { src: string; label: string; ratio: number; pages?: Pages; onClose: () => void };

export function PictureView({ src, label, ratio, pages, onClose }: Props) {
  const view = useRef<HTMLDivElement>(null);
  // The picture and its buttons are not the backdrop; every empty box around them is.
  useLayer(true, { outside: (target) => view.current!.contains(target) && !(target as Element).closest(`img, .${styles.chrome}`), close: onClose });
  const trap = useFocusTrap(view);
  const paged = pages && pages.count > 1 ? pages : undefined;
  const keys = (event: KeyboardEvent) => {
    trap(event);
    if (!paged || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    paged.onStep(event.key === 'ArrowLeft' ? -1 : 1);
  };
  return createPortal(
    // Stop portal bubbling into the source message. Backdrop pointerdown closes; suppress mousedown afterward
    // so it cannot move restored focus back onto the page.
    <div
      ref={view}
      className={styles.view}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={keys}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.stage}>
        <img className={styles.image} src={src} alt={label} style={{ '--ratio': ratio } as CSSProperties} />
      </div>
      <div className={styles.top}>
        {paged && <span className={`${styles.chrome} ${styles.count}`}>{`${paged.at + 1} / ${paged.count}`}</span>}
        <span className={`${styles.chrome} ${styles.close}`}>
          <IconButton icon={X} label="닫기" onClick={onClose} />
        </span>
      </div>
      {paged && (
        <>
          <span className={`${styles.chrome} ${styles.side} ${styles.prev}`}>
            <IconButton icon={ChevronLeft} label="이전" onClick={() => paged.onStep(-1)} />
          </span>
          <span className={`${styles.chrome} ${styles.side} ${styles.next}`}>
            <IconButton icon={ChevronRight} label="다음" onClick={() => paged.onStep(1)} />
          </span>
        </>
      )}
    </div>,
    document.body,
  );
}
