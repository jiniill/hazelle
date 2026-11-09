import { ChevronRight } from 'lucide-react';
import { useContext, useId, useState, type ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { OpenFold, useSeeking } from '../foundation/seek';
import styles from './Disclosure.module.css';

// question: a question asked of a page (a guide's 자주 묻는 질문), in a row's title look, wrapping from its start.
type Props = { label: string; variant?: 'line' | 'question'; menu?: ReactNode; children: ReactNode } & ({ open: boolean; onOpen: (open: boolean) => void } | { open?: never; onOpen?: never });

// What is folded is made only while open, so a long list of them stays light; a seek makes it hidden, so a row inside can
// answer.

export function Disclosure({ label, variant = 'line', menu, open: held, onOpen, children }: Props) {
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
        <button type="button" className={`${styles.toggle} ${styles[variant]}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className={styles.chevron}>
            <Icon icon={ChevronRight} size="sm" />
          </span>
          {label}
        </button>
        {variant === 'line' && <span className={styles.rule} aria-hidden />}
        {menu}
      </div>
      <div id={id} className={styles.body} hidden={!open}>
        {(open || seeking) && <OpenFold value={openAll}>{children}</OpenFold>}
      </div>
    </div>
  );
}
