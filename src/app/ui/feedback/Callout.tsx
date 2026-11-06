import { CircleCheck, Lightbulb, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { Icon } from '../foundation/Icon';
import styles from './Callout.module.css';

const ICONS = { warn: TriangleAlert, success: CircleCheck, tip: Lightbulb };

type Props = {
  tone: keyof typeof ICONS;
  alert?: boolean;
  action?: { label: string; onClick: () => void };
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
  return (
    <div className={styles.withAction}>
      {note}
      <Button variant="secondary" size="md" onClick={action.onClick}>
        {action.label}
      </Button>
    </div>
  );
}
