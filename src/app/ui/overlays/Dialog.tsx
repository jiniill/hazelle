import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ButtonSlot } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Kbd } from '../foundation/Kbd';
import { useLeaves } from '../foundation/leave';
import { keyCaps, type Chord } from '../foundation/keys';
import { Row } from '../layout/Row';
import { Switcher } from '../story/StoryMessage';
import styles from './Dialog.module.css';
import { useFocusTrap, useLayer } from './layers';
import { stepByKey, stepping, useSwipe, type Pages } from './pages';

type Props = {
  title: string;
  note?: string;
  // Absent while it cannot close (a file being read or saved): no ×, and Esc, a press outside and a back leave it.
  onClose?: () => void;
  onSubmit?: () => void;
  actions?: ReactNode;
  actionsLayout?: 'full' | 'row';
  // wide: a picker of many, at a fixed height so a search does not resize it, and a sheet from the bottom on a phone.
  // full: nearly the whole screen, all of a phone's; a text edited big (useBigEdit), its body a column to fill.
  size?: 'normal' | 'wide' | 'full';
  // Above and below the scrolling body, always in view, as the actions are.
  toolbar?: ReactNode;
  footer?: ReactNode;
  // Stepped by the head's switcher, ← → and a sideways swipe, the dialog showing one of them at a time.
  pages?: Pages;
  children: ReactNode;
};

export function Dialog({ title, note, onClose, onSubmit, actions, actionsLayout = 'row', size = 'normal', toolbar, footer, pages, children }: Props) {
  const scrim = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Only the scrim itself is outside: the toast sits above the dialog and stays pressable while it is open.
  useLayer(true, { outside: (target) => target === scrim.current, close: onClose, takesBack: true });
  const trap = useFocusTrap(box);
  const paged = stepping(pages);
  const swipe = useSwipe(paged);
  const body = (
    <>
      <div className={styles.body}>{children}</div>
      {actions && <ButtonSlot value="md">{actionsLayout === 'full' ? actions : <Row kind="actions">{actions}</Row>}</ButtonSlot>}
    </>
  );
  // A dialog opened from a button in a head does not take that head's button size. On the body, so no stacking context
  // of where it was opened from (the sticky sidebar's) holds it under the page beside it.
  return createPortal(
    <ButtonSlot value={null}>
    <div ref={useLeaves(scrim)} className={size === 'normal' ? styles.scrim : `${styles.scrim} ${size === 'wide' ? styles.sheet : styles.bare}`}>
      <div ref={box} className={size === 'normal' ? styles.dialog : `${styles.dialog} ${styles[size]}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={(event) => { trap(event); stepByKey(paged, event); }} {...swipe}>
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          {paged && (
            <Switcher
              count={`${paged.at + 1} / ${paged.count}`}
              prev={{ label: '이전', onClick: () => paged.onStep(-1) }}
              next={{ label: '다음', onClick: () => paged.onStep(1) }}
            />
          )}
          {onClose && <IconButton icon={X} label="닫기" size="sm" onClick={onClose} />}
        </div>
        {note && <p className={styles.note}>{note}</p>}
        {toolbar}
        {onSubmit ? (
          // The submit button among the actions stays in the form, which draws no box of its own.
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
        {footer && <div className={styles.footer}><ButtonSlot value="md">{footer}</ButtonSlot></div>}
      </div>
    </div>
    </ButtonSlot>,
    document.body,
  );
}

export function Shortcuts({ items }: { items: readonly { label: string; keys: readonly Chord[] }[] }) {
  return (
    <dl className={styles.shortcuts}>
      {items.map((item) => (
        <div key={item.label} className={styles.shortcut}>
          <dt className={styles.action}>{item.label}</dt>
          <dd className={styles.keys}>
            {item.keys.flatMap(keyCaps).map((cap, index) => (
              // A cap repeats across chords (Ctrl+, and Ctrl+S): its place is its identity.
              <Kbd key={index}>{cap}</Kbd>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}
