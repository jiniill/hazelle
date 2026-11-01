import { ArrowDown, ArrowUp, GripVertical, type LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Button } from '../controls/Button';
import { Checkbox } from '../controls/Checkbox';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import { useCoarsePointer } from '../foundation';
import { useDragOrder } from './dragOrder';
import styles from './CheckList.module.css';

export type CheckListItem = { id: string; label: string; icon: LucideIcon; dot: boolean; checked: boolean; action?: { label: string; onClick: () => void } };

// Drag where there is a fine pointer, arrows where a drag would fight the scroll.
export function CheckList({ items, onCheck, onMove }: { items: CheckListItem[]; onCheck: (id: string, checked: boolean) => void; onMove: (from: number, to: number) => void }) {
  const coarse = useCoarsePointer();
  const order = useDragOrder(onMove, 'y');
  const key = (event: KeyboardEvent, index: number) => {
    const to = index + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0);
    if (to === index || to < 0 || to >= items.length) return;
    event.preventDefault();
    onMove(index, to);
  };
  return (
    <div className={styles.list} onDragOver={order.allow} onDrop={order.drop}>
      {items.map((item, index) => (
        <div
          key={item.id}
          className={styles.row}
          draggable={!coarse}
          onDragStart={(event) => order.start(event, index, item.id)}
          onDragOver={(event) => order.over(event, index)}
          onDragEnd={order.end}
        >
          {order.at === index && <span className={`${styles.drop} ${styles.before}`} />}
          {order.at === index + 1 && index === items.length - 1 && <span className={`${styles.drop} ${styles.after}`} />}
          {coarse ? (
            <span className={styles.arrows}>
              <IconButton icon={ArrowUp} size="sm" label={`'${item.label}' 위로`} disabled={index === 0} onClick={() => onMove(index, index - 1)} />
              <IconButton icon={ArrowDown} size="sm" label={`'${item.label}' 아래로`} disabled={index === items.length - 1} onClick={() => onMove(index, index + 1)} />
            </span>
          ) : (
            <button type="button" className={styles.handle} aria-label={`'${item.label}' 순서`} title="끌어서 순서 바꾸기" onKeyDown={(event) => key(event, index)}>
              <Icon icon={GripVertical} size="sm" />
            </button>
          )}
          <Checkbox label={item.label} icon={item.icon} checked={item.checked} onChange={(checked) => onCheck(item.id, checked)} />
          {item.dot && <span className={styles.dot} aria-label="사용 중" role="img" />}
          {item.action && (
            <span className={styles.action}>
              <Button variant="ghost" size="sm" label={`${item.action.label}: ${item.label}`} onClick={item.action.onClick}>{item.action.label}</Button>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
