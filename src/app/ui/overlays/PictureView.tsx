import { ChevronLeft, ChevronRight, X, ZoomIn, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { STEP_KEYS, stepByKey, stepping, useSwipe, type Pages } from './pages';
import { createPortal } from 'react-dom';
import { Button, ButtonSlot } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { pressed, titled, type Chord } from '../foundation/keys';
import { useVeil } from '../foundation/veil';
import styles from './PictureView.module.css';
import { useFocusTrap, useLayer } from './layers';

// Mod and Shift held are left to the page: Ctrl+Z is undo.
export const ZOOM_KEYS = { label: '확대 · 축소', keys: [{ key: 'z', mod: false, shift: false }] } as const;

export type PictureAction = { icon: LucideIcon; label: string; warn?: boolean; keys?: readonly Chord[]; run: () => void };

type Props = {
  // undefined while it is read, or when it could not be: the bars stay, so its actions still reach it.
  src: string | undefined;
  label: string;
  video?: boolean;
  // Over the picture beside its own size: what it is called and what kind of file it is.
  title?: string;
  note?: string;
  // Under the picture, each also run by its keys.
  actions?: readonly PictureAction[];
  pages?: Pages;
  onClose: () => void;
};

type Size = { src: string; width: number; height: number };

export function PictureView({ src, label, video = false, title, note, actions = [], pages, onClose }: Props) {
  const view = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  // Its backdrop closes it on a tap (onClick below), not on the press that may begin a swipe or a pan.
  useLayer(true, { outside: () => false, close: onClose, takesBack: true });
  const trap = useFocusTrap(view);
  const paged = stepping(pages);
  const veil = useVeil();
  // Opened by a press of its own, so each picture it shows, a version stepped to as well, stays uncovered after.
  useEffect(() => {
    if (src) veil?.revealed.add(src);
  }, [veil, src]);
  const [size, setSize] = useState<Size | null>(null);
  const measured = size?.src === src ? size : null;
  const [zoomed, setZoomed] = useState(false);
  const toggle = () => setZoomed(!zoomed);
  // Zoomed, a sideways stroke pans the picture, so neither it nor ← → steps.
  const turned = zoomed ? undefined : paged;
  const swipe = useSwipe(turned);
  const keyed = [{ keys: ZOOM_KEYS.keys, run: toggle }, ...actions.flatMap(({ keys, run }) => (keys ? [{ keys, run }] : []))];
  const keys = (event: KeyboardEvent) => {
    trap(event);
    stepByKey(turned, event);
    const hit = event.defaultPrevented ? undefined : keyed.find((action) => pressed(event, action.keys));
    if (!hit) return;
    event.preventDefault();
    hit.run();
  };
  const facts = [note, measured && `${measured.width}×${measured.height}`].filter(Boolean).join(' · ');
  const shape = measured ? styles.image : `${styles.image} ${styles.waiting}`;
  const ratio = measured ? ({ '--ratio': measured.width / measured.height, '--own-width': `${measured.width}px` } as CSSProperties) : undefined;
  return createPortal(
    // Stop portal bubbling into the source message. Only its empty boxes are the backdrop: the picture and every bar
    // sit inside them, never matched by a class selector, which a composed module class breaks. A press on it keeps the
    // focus in the view.
    <div
      ref={view}
      className={styles.view}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onKeyDown={keys}
      {...swipe}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === view.current || event.target === stage.current) onClose();
      }}
    >
      <div className={styles.top}>
        {(title || facts) && (
          <span className={`${styles.chrome} ${styles.about}`}>
            {title && <span className={styles.title}>{title}</span>}
            {facts && <span>{facts}</span>}
          </span>
        )}
        {paged && <span className={`${styles.chrome} ${styles.count}`}>{`${paged.at + 1} / ${paged.count}`}</span>}
        <span className={`${styles.chrome} ${styles.tools}`}>
          <IconButton icon={ZoomIn} label="확대" title={titled(zoomed ? '축소' : '확대', ZOOM_KEYS.keys)} pressed={zoomed} onClick={toggle} />
          <IconButton icon={X} label="닫기" title={titled('닫기', [{ key: 'Escape' }])} onClick={onClose} />
        </span>
      </div>
      <div ref={stage} className={zoomed ? `${styles.stage} ${styles.zoomed}` : styles.stage}>
        {src === undefined ? null : video ? (
          <video key={src} className={shape} style={ratio} src={src} aria-label={label} controls autoPlay muted loop playsInline onLoadedMetadata={({ currentTarget: { videoWidth, videoHeight } }) => setSize({ src, width: videoWidth, height: videoHeight })} />
        ) : (
          <img key={src} className={shape} style={ratio} src={src} alt={label} onClick={toggle} onLoad={({ currentTarget: { naturalWidth, naturalHeight } }) => setSize({ src, width: naturalWidth, height: naturalHeight })} />
        )}
      </div>
      {actions.length > 0 && (
        <div className={`${styles.chrome} ${styles.foot}`}>
          <ButtonSlot value="sm">
            {actions.map(({ icon, label, warn, run }) => (
              <Button key={label} variant={warn ? 'danger' : 'ghost'} icon={icon} onClick={run}>
                {label}
              </Button>
            ))}
          </ButtonSlot>
        </div>
      )}
      {paged && (
        <>
          <span className={`${styles.chrome} ${styles.side} ${styles.prev}`}>
            <IconButton icon={ChevronLeft} label="이전" title={titled('이전', [STEP_KEYS.keys[0]])} onClick={() => paged.onStep(-1)} />
          </span>
          <span className={`${styles.chrome} ${styles.side} ${styles.next}`}>
            <IconButton icon={ChevronRight} label="다음" title={titled('다음', [STEP_KEYS.keys[1]])} onClick={() => paged.onStep(1)} />
          </span>
        </>
      )}
    </div>,
    document.body,
  );
}
