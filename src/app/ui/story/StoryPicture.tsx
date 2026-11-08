import { useReducer, useState, type CSSProperties, type ReactNode } from 'react';
import { useVeil } from '../foundation/veil';
import { PictureView } from '../overlays/PictureView';
import styles from './StoryPicture.module.css';
import { Switcher } from './StoryMessage';

type Props = {
  // undefined while it loads; the frame keeps its shape meanwhile.
  src: string | undefined;
  label: string;
  width: number;
  height: number;
  // In the picture's place while it is being made.
  status?: string;
  foot?: ReactNode;
  // The versions of its place: the one shown, and each one's words in the menu that picks it (such as its time).
  pages?: { at: number; versions: string[]; onPage: (index: number) => void };
};

export function StoryPicture({ src, label, width, height, status, foot, pages }: Props) {
  const count = pages?.versions.length ?? 0;
  const step = (by: -1 | 1) => pages!.onPage((pages!.at + by + count) % count);
  const veil = useVeil();
  // A veil tapped open or shut changes only veil.revealed, which no render sees.
  const [, tapVeil] = useReducer((count: number) => count + 1, 0);
  const [open, setOpen] = useState(false);
  const veiled = veil !== null && src !== undefined && !open && !veil.revealed.has(src);
  return (
    <figure className={styles.picture}>
      <div className={status ? `${styles.frame} ${styles.making}` : styles.frame} style={{ '--ratio': width / height } as CSSProperties}>
        {status ? (
          <span className={styles.status}>{status}</span>
        ) : veiled ? (
          <button
            type="button"
            className={styles.veil}
            onClick={() => {
              veil.revealed.add(src);
              tapVeil();
            }}
          >
            이미지 보기
          </button>
        ) : (
          src && (
            <>
              <button type="button" className={styles.open} aria-label={`${label} 크게 보기`} onClick={() => setOpen(true)}>
                <img className={styles.image} src={src} alt={label} />
              </button>
              {open && <PictureView src={src} label={label} pages={pages && { at: pages.at, count, onStep: step }} onClose={() => setOpen(false)} />}
              {veil && (
                <button
                  type="button"
                  className={styles.cover}
                  aria-label="이미지 가리기"
                  onClick={() => {
                    veil.revealed.delete(src);
                    tapVeil();
                  }}
                >
                  가리기
                </button>
              )}
            </>
          )
        )}
      </div>
      {(count > 1 || foot) && (
        <figcaption className={styles.foot}>
          {pages && count > 1 && (
            <Switcher
              count={`${pages.at + 1} / ${count}`}
              prev={{ label: '이전', onClick: () => step(-1) }}
              next={{ label: '다음', onClick: () => step(1) }}
              pick={{ versions: pages.versions, selected: pages.at, disabled: false, onPick: pages.onPage }}
            />
          )}
          {foot}
        </figcaption>
      )}
    </figure>
  );
}
