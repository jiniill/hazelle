import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { Row } from '../layout/Row';
import { Hint } from '../overlays/Hint';
import styles from './NoticeBar.module.css';

type Props = { icon: LucideIcon; title: string; note?: string; hint?: { label: string; text: string }; actions: ReactNode };

// What standing somewhere means, in one line, where the whole of it (NoticeCard) would ask too much of the screen.
export function NoticeBar({ icon, title, note, hint, actions }: Props) {
  return (
    <section className={styles.bar} aria-label={title}>
      <span className={styles.lead}>
        <span className={styles.icon}>
          <Icon icon={icon} />
        </span>
        <span className={styles.words}>
          <span className={styles.title}>{title}</span>
          {note && (
            <span className={styles.note}>
              {note}
              {hint && <Hint label={hint.label}>{hint.text}</Hint>}
            </span>
          )}
        </span>
      </span>
      <Row kind="actions">{actions}</Row>
    </section>
  );
}
