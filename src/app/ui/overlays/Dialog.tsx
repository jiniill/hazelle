import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { ButtonSlot } from '../controls/Button';
import { IconButton } from '../controls/IconButton';
import { Kbd } from '../foundation/Kbd';
import { keyCaps, type Chord } from '../foundation/keys';
import { Row } from '../layout/Row';
import { Stack } from '../layout/Stack';
import styles from './Dialog.module.css';
import { useFocusTrap, useLayer } from './layers';

type Props = {
  title: string;
  note?: string;
  onClose: () => void;
  onSubmit?: () => void;
  actions?: ReactNode;
  actionsLayout?: 'full' | 'row';
  // wide: a picker of many, at a fixed height so a search does not resize it, and a sheet from the bottom on a phone.
  // full: nearly the whole screen, all of a phone's; a text edited big (useBigEdit), its body a column to fill.
  size?: 'normal' | 'wide' | 'full';
  // Above and below the scrolling body, always in view.
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function Dialog({ title, note, onClose, onSubmit, actions, actionsLayout = 'row', size = 'normal', toolbar, footer, children }: Props) {
  const scrim = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Only the scrim itself is outside: the toast sits above the dialog and stays pressable while it is open.
  useLayer(true, { outside: (target) => target === scrim.current, close: onClose, takesBack: true });
  const trap = useFocusTrap(box);
  const body = actions ? (
    <Stack gap={actionsLayout === 'full' ? 'related' : 'group'}>
      {children}
      <ButtonSlot value="md">{actionsLayout === 'full' ? actions : <Row kind="actions">{actions}</Row>}</ButtonSlot>
    </Stack>
  ) : (
    children
  );
  // A dialog opened from a button in a head does not take that head's button size.
  return (
    <ButtonSlot value={null}>
    <div ref={scrim} className={size === 'normal' ? styles.scrim : `${styles.scrim} ${size === 'wide' ? styles.sheet : styles.bare}`}>
      <div ref={box} className={size === 'normal' ? styles.dialog : `${styles.dialog} ${styles[size]}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={trap}>
        <div className={styles.head}>
          <h2 className={styles.title}>{title}</h2>
          <IconButton icon={X} label="닫기" size="sm" onClick={onClose} />
        </div>
        {note && <p className={styles.note}>{note}</p>}
        {toolbar}
        <div className={styles.body}>
          {onSubmit ? (
            <form
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
        </div>
        {footer && <div className={styles.footer}><ButtonSlot value="md">{footer}</ButtonSlot></div>}
      </div>
    </div>
    </ButtonSlot>
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
