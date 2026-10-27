import { X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import { Row } from '../layout/Row';
import styles from './NoticeCard.module.css';

type Props = {
  title: string;
  note?: string;
  points: { icon: LucideIcon; text: string }[];
  actions?: ReactNode;
  foot?: ReactNode;
  // Given, a × puts the card away; the caller keeps that it was.
  onClose?: () => void;
};

export function NoticeCard({ title, note, points, actions, foot, onClose }: Props) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.head}>
        <div className={styles.words}>
          <span className={styles.title}>{title}</span>
          {note && <span className={styles.note}>{note}</span>}
        </div>
        {onClose && <IconButton icon={X} size="sm" label="닫기" onClick={onClose} />}
      </div>
      <ul className={styles.points}>
        {points.map(({ icon, text }) => (
          <li key={text} className={styles.point}>
            <span className={styles.icon}>
              <Icon icon={icon} />
            </span>
            {text}
          </li>
        ))}
      </ul>
      {actions && <Row kind="actions">{actions}</Row>}
      {foot && <p className={styles.foot}>{foot}</p>}
    </section>
  );
}
