import type { LucideIcon } from 'lucide-react';
import { Button } from '../controls/Button';
import styles from './Divider.module.css';
import { Icon } from './Icon';
import { useShape } from './theme';

type Story = { label: string; icon?: LucideIcon; actions?: { label: string; onClick: () => void }[] };
type Props = Story | { variant: 'menu' | 'tools' | 'rail' };

// A line across the story, such as a day's (a theme's day shape). rule: what it says between two rules. pill: no
// rules, what it says centred on a fill of its own; one that says nothing is still a rule.
function StoryDivider({ label, icon, actions = [] }: Story) {
  const pill = useShape('day') === 'pill';
  const said = (
    <>
      {icon && <Icon icon={icon} size="sm" />}
      {label && <span className={styles.label}>{label}</span>}
      {actions.length > 0 && <span className={styles.actions}>
        {actions.map((action) => <Button key={action.label} variant="link" size="xs" onClick={action.onClick}>{action.label}</Button>)}
      </span>}
    </>
  );
  const says = Boolean(label || icon || actions.length > 0);
  // A separator's children are presentational, so a line holding a button is not one.
  return (
    <div className={icon ? `${styles.story} ${styles.marked}` : styles.story} role={actions.length ? undefined : 'separator'}>
      {pill && says ? (
        <span className={styles.pill}>{said}</span>
      ) : (
        <>
          <span className={styles.rule} />
          {said}
          {says && <span className={styles.rule} />}
        </>
      )}
    </div>
  );
}

export function Divider(props: Props) {
  if ('label' in props) return <StoryDivider {...props} />;
  return <span className={styles[props.variant]} role={props.variant === 'menu' ? 'separator' : undefined} />;
}
