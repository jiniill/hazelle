import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from '../foundation/Icon';
import { Row } from '../layout/Row';
import styles from './NoticeCard.module.css';

type Props = {
  title: string;
  note?: string;
  points: { icon: LucideIcon; text: string }[];
  actions?: ReactNode;
  foot?: ReactNode;
};

export function NoticeCard({ title, note, points, actions, foot }: Props) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.words}>
        <span className={styles.title}>{title}</span>
        {note && <span className={styles.note}>{note}</span>}
      </div>
      <ul className={styles.points}>
        {points.map(({ icon, text }) => (
          <li key={text} className={styles.point}>
            <span className={styles.icon}>
              <Icon icon={icon} size="sm" />
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
