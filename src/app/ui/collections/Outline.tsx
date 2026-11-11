import { ArrowDown, ArrowUp, Bookmark, ChevronRight, GitBranch, GripVertical, Plus, X, type LucideIcon } from 'lucide-react';
import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '../controls/IconButton';
import { Icon } from '../foundation/Icon';
import { Tag } from '../foundation/Tag';
import { Menu, type MenuOpener } from '../overlays/Menu';
import { useDragOrder } from './dragOrder';
import styles from './Outline.module.css';
import { classNames } from '../foundation/classNames';

// The rail's sections, each drawn in its own color (tokens.css --color-kind-*).
export type OutlineKind = 'text' | 'char' | 'lore' | 'chat' | 'note';

export type OutlineStop = {
  id: string;
  kind: OutlineKind;
  icon: LucideIcon;
  title: string;
  dim?: boolean;
  note?: string;
  badge?: string;
  flagged?: boolean;
  // A cache point after the stop, drawn as a dashed line under it: one set on it, or one the app sets itself.
  cache?: 'set' | 'auto';
  label: string;
};

type Props = {
  label: string;
  help: string;
  start: string;
  end: string;
  stops: OutlineStop[];
  current: string | null;
  onPick: (id: string) => void;
  onOpen: (id: string) => void;
  onRemove: (id: string) => void;
  // to is the index the stop ends at.
  onMove: (from: number, to: number) => void;
  insert: (index: number) => ReactNode;
  onCache: (id: string) => void;
  // hover: a row's tools and the + between rows show under a pointer that hovers, and a row is dragged by its place.
  // shown: they stand open for a finger, arrows in the drag's place.
  tools?: 'hover' | 'shown';
  drill?: boolean;
};

export function Outline({ label, help, start, end, stops, current, onPick, onOpen, onRemove, onMove, insert, onCache, tools = 'hover', drill = false }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const helpId = useId();
  const refocus = useRef<string | null>(null);

  const focusStop = (id: string) => list.current?.querySelector<HTMLElement>(`[data-stop="${CSS.escape(id)}"]`)?.focus();

  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    focusStop(id);
  }, [stops]);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= stops.length || to === from) return;
    refocus.current = stops[from]!.id;
    onMove(from, to);
  };
  const order = useDragOrder(move, 'y');

  const key = (event: KeyboardEvent, index: number) => {
    const stop = stops[index]!;
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (step !== 0) {
      event.preventDefault();
      if (event.altKey) return move(index, index + step);
      const next = stops[index + step];
      if (!next) return;
      onPick(next.id);
      focusStop(next.id);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(stop.id);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      refocus.current = (stops[index + 1] ?? stops[index - 1])?.id ?? null;
      onRemove(stop.id);
    }
  };

  const addMenu = (index: number, trigger: (opener: MenuOpener) => ReactNode) => (
    <Menu label="블록 추가" size="lg" place="start" trigger={trigger}>
      {insert(index)}
    </Menu>
  );
  const plus = (index: number, where: string) => (
    <span className={styles.plusAt}>
      {addMenu(index, (opener) => (
        <button type="button" className={styles.plus} aria-label={where} title="여기에 추가" ref={opener.ref} aria-haspopup="menu" aria-expanded={opener.expanded} onClick={opener.onClick}>
          <Icon icon={Plus} size="sm" />
        </button>
      ))}
    </span>
  );

  const cut = (stop: OutlineStop | undefined) =>
    stop?.cache && (
      <span className={`${styles.cut} ${styles[stop.cache]}`} aria-hidden>
        <span className={styles.cutLabel}>
          <Icon icon={Bookmark} size="sm" />
          {stop.cache === 'set' ? '여기까지 캐시' : '자동 캐시'}
        </span>
      </span>
    );
  const lastStop = stops.at(-1);
  const hovered = tools === 'hover';

  return (
    <div className={classNames(styles.outline, !hovered && styles.shown, drill && styles.drill)} ref={list}>
      <span id={helpId} className={styles.help}>
        {help}
      </span>
      <div className={styles.cap} aria-hidden>
        <span className={`${styles.end} ${styles.open}`} />
        <span className={styles.capLabel}>{start}</span>
      </div>
      <div role="list" aria-label={label} className={lastStop?.cache ? `${styles.stops} ${styles.cutEnd}` : styles.stops} onDragOver={order.allow} onDrop={order.drop}>
        {stops.map((stop, index) => {
          const above = stops[index - 1];
          const classes = classNames(styles.stop, above?.cache && styles.cutAbove, index === 0 && styles.first, order.from === index && styles.dragged);
          return (
            <div key={stop.id} role="listitem" className={classes} onDragOver={(event) => order.over(event, index)}>
              <span className={`${styles.segment} ${styles[above?.kind ?? stop.kind]}`} aria-hidden />
              {index === stops.length - 1 && <span className={`${styles.segment} ${styles.last} ${styles[stop.kind]}`} aria-hidden />}
              <div className={styles.gap}>
                {cut(above)}
                {order.at === index && <span className={styles.drop} />}
                {plus(index, `${index + 1}번째에 추가`)}
              </div>
              <div className={styles.row} aria-current={stop.id === current || undefined}>
                <button
                  type="button"
                  className={styles.button}
                  data-stop={stop.id}
                  draggable={hovered}
                  aria-label={stop.label}
                  aria-describedby={helpId}
                  aria-current={stop.id === current || undefined}
                  onClick={() => onPick(stop.id)}
                  onKeyDown={(event) => key(event, index)}
                  onDragStart={(event) => order.start(event, index, stop.id)}
                  onDragEnd={order.end}
                >
                  <span className={styles.number}>{index + 1}</span>
                  {hovered && (
                    <span className={styles.grip}>
                      <Icon icon={GripVertical} size="sm" />
                    </span>
                  )}
                  <span className={`${styles.node} ${styles[stop.kind]}`}>
                    <stop.icon className={styles.glyph} aria-hidden />
                  </span>
                  <span className={styles.title}>
                    <span className={stop.dim ? `${styles.name} ${styles.dim}` : styles.name}>{stop.title}</span>
                    {stop.flagged && (
                      <span className={styles.flag} title="토글 조건 있음">
                        <Icon icon={GitBranch} size="sm" />
                      </span>
                    )}
                    {stop.badge && <Tag tone="accent">{stop.badge}</Tag>}
                  </span>
                  {hovered && <span className={styles.meta}>{stop.note}</span>}
                  {drill && hovered && <Icon icon={ChevronRight} size="sm" />}
                </button>
                <span className={styles.tools}>
                  {!hovered && (
                    <>
                      <IconButton icon={ArrowUp} size="sm" label={`'${stop.title}' 위로`} disabled={index === 0} onClick={() => move(index, index - 1)} />
                      <IconButton icon={ArrowDown} size="sm" label={`'${stop.title}' 아래로`} disabled={index === stops.length - 1} onClick={() => move(index, index + 1)} />
                    </>
                  )}
                  {hovered && stop.cache !== 'auto' && (
                    <IconButton
                      icon={Bookmark}
                      size="sm"
                      label={`'${stop.title}'까지 캐시`}
                      title={stop.cache ? '캐시 지점 해제' : '여기까지 캐시'}
                      pressed={stop.cache === 'set'}
                      onClick={() => onCache(stop.id)}
                    />
                  )}
                  <IconButton icon={X} size="sm" label={`'${stop.title}' 빼기`} title="빼기" onClick={() => onRemove(stop.id)} />
                </span>
              </div>
            </div>
          );
        })}
        <div className={styles.tail}>
          {cut(lastStop)}
          {order.at === stops.length && <span className={styles.drop} />}
          {plus(stops.length, '맨 끝에 추가')}
        </div>
      </div>
      <div className={styles.cap} aria-hidden>
        <span className={`${styles.end} ${styles.closed}`} />
        <span className={styles.capLabel}>{end}</span>
      </div>
    </div>
  );
}
