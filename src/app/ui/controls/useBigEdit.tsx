import { Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatKeys, pressed, type Chord } from '../foundation/keys';
import { Dialog } from '../overlays/Dialog';
import { areaCaret, type Caret } from './codeLanguage';
import { IconButton } from './IconButton';
import styles from './useBigEdit.module.css';

const LABEL = '크게 편집';

// Keep area/caret refs stable: recreating callbacks would reapply the caret on every render.
export type BigCopy = { area: (element: HTMLTextAreaElement | null) => void; caret: (handle: Caret | null) => void };

// Big editor shares the live value, not a save/cancel draft. Never reuse the small field's ref:
// unmounting the copy would clear a ref still used for prompt insertion.
export function useBigEdit(keys: readonly Chord[] | undefined, title: string, big: (copy: BigCopy) => ReactNode, note?: string) {
  const field = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const caret = useRef<[number, number] | null>(null);
  const copy = useRef<Caret | null>(null);
  const opened = useRef(false);
  opened.current = open;

  const inline = () => {
    const area = field.current?.querySelector('textarea');
    return area ? areaCaret(area) : null;
  };
  const place = (target: Caret | null) => {
    const at = caret.current;
    if (!target || !at) return;
    target.focus();
    target.select(at);
  };
  const [bound] = useState<BigCopy>(() => {
    // A copy that loads after the dialog opens (the code editor) takes the caret when it arrives.
    const take = (handle: Caret | null) => {
      copy.current = handle;
      if (handle && opened.current) place(handle);
    };
    return { caret: take, area: (element) => take(element && areaCaret(element)) };
  });

  const toggle = (to: boolean) => {
    caret.current = (to ? inline() : copy.current)?.selection() ?? null;
    setOpen(to);
  };
  // Restore caret after dialog focus handling. Do not consume it: StrictMode replays effects and the trap moves focus again.
  useEffect(() => {
    place(open ? copy.current : inline());
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!keys || !pressed(event, keys)) return;
    event.preventDefault();
    toggle(!open);
  };

  return {
    wrap: { ref: field, onKeyDown },
    button: keys && <IconButton icon={Maximize2} label={LABEL} title={`${LABEL} · ${formatKeys(keys)}`} size="sm" onClick={() => toggle(true)} />,
    dialog: open && (
      <Dialog title={title} note={note} size="full" onClose={() => toggle(false)}>
        <div className={styles.fill} onKeyDown={onKeyDown}>
          {big(bound)}
        </div>
      </Dialog>
    ),
  };
}
