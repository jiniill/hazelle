import { ChevronRight } from 'lucide-react';
import { useContext, useId, useState, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { OpenFold, useSeeking } from '../foundation/seek';
import styles from './Disclosure.module.css';

type Props = { label: string; menu?: ReactNode; children: ReactNode } & ({ open: boolean; onOpen: (open: boolean) => void } | { open?: never; onOpen?: never });

// What is folded is made only while open, so a long list of them stays light; a seek makes it hidden, so a row inside can
// answer.

export function Disclosure({ label, menu, open: held, onOpen, children }: Props) {
  const [own, setOwn] = useState(false);
  const open = held ?? own;
  const setOpen = onOpen ?? setOwn;
  const id = useId();
  const seeking = useSeeking();
  const openOuter = useContext(OpenFold);
  const openAll = () => {
    openOuter();
    setOpen(true);
  };
  return (
    <div className={styles.disclosure}>
      <div className={styles.head}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className={styles.chevron}>
            <Icon icon={ChevronRight} size="sm" />
          </span>
          {label}
        </button>
        <span className={styles.line} aria-hidden />
        {menu}
      </div>
      <div id={id} className={styles.body} hidden={!open}>
        {(open || seeking) && <OpenFold value={openAll}>{children}</OpenFold>}
      </div>
    </div>
  );
}
