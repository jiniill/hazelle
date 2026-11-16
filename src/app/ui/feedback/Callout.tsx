import { CircleCheck, Lightbulb, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { Icon } from '../foundation/Icon';
import { Row } from '../layout/Row';
import styles from './Callout.module.css';

const ICONS = { warn: TriangleAlert, success: CircleCheck, tip: Lightbulb };

type Act = { label: string; onClick: () => void };

type Props = {
  tone: keyof typeof ICONS;
  alert?: boolean;
  action?: Act | readonly Act[];
  children: ReactNode;
};

export function Callout({ tone, alert = false, action, children }: Props) {
  const note = (
    <div className={`${styles.callout} ${styles[tone]}`} role={alert ? 'alert' : undefined}>
      <span className={styles.icon}>
        <Icon icon={ICONS[tone]} />
      </span>
      <p>{children}</p>
    </div>
  );
  if (!action) return note;
  const button = ({ label, onClick }: Act) => (
    <Button key={label} variant="secondary" size="md" onClick={onClick}>
      {label}
    </Button>
  );
  return (
    <div className={styles.withAction}>
      {note}
      {'label' in action ? button(action) : <Row kind="actions">{action.map(button)}</Row>}
    </div>
  );
}
