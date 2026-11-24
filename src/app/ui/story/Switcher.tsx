import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import { IconButton } from '../controls/IconButton';
import { Menu, MenuItem } from '../overlays/Menu';
import styles from './Switcher.module.css';

type Step = { label: string; title?: string; disabled?: boolean; onClick: () => void };

type SwitcherProps = {
  // Where it stands among the rest, such as 2 / 5; '' for nowhere yet.
  count: string;
  prev: Step;
  next: Step;
  // The versions to pick from by the count; without, the count is only read out as it changes.
  pick?: { versions: string[]; selected: number; disabled: boolean; onPick: (index: number) => void };
  // down: to what stands above and below, such as search hits.
  axis?: 'across' | 'down';
};

export function Switcher({ count, prev, next, pick, axis = 'across' }: SwitcherProps) {
  const [before, after] = axis === 'across' ? [ChevronLeft, ChevronRight] : [ChevronUp, ChevronDown];
  return (
    <div className={pick ? `${styles.switcher} ${styles.versions}` : styles.switcher}>
      <IconButton icon={before} label={prev.label} title={prev.title} size="sm" disabled={prev.disabled} onClick={prev.onClick} />
      {pick ? (
        <Menu
          label="버전 선택"
          place="above-start"
          trigger={(opener) => (
            <button type="button" className={styles.count} title="버전 선택" disabled={pick.disabled} ref={opener.ref} aria-haspopup={opener.popup} aria-expanded={opener.expanded} onClick={opener.onClick}>
              {count}
            </button>
          )}
        >
          {pick.versions.map((line, index) => (
            <MenuItem key={index} label={`${index + 1}`} description={line} checked={index === pick.selected} onClick={() => pick.onPick(index)} />
          ))}
        </Menu>
      ) : (
        count && <span className={styles.count} aria-live="polite">{count}</span>
      )}
      <IconButton icon={after} label={next.label} title={next.title} size="sm" disabled={next.disabled} onClick={next.onClick} />
    </div>
  );
}
