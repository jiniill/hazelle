import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Tag } from '../foundation/Tag';
import { pathOf, type FlowEdge, type FlowKind } from './flow';
import styles from './FlowMap.module.css';
import { tokenPx } from '../foundation/tokenPx';
import { classNames } from '../foundation/classNames';
import { useNarrowerThan } from '../foundation/useNarrowerThan';

// lead: what the node stands for, over its title (a role over its model); note: what it holds or runs on.
export type FlowNode = { id: string; title: string; lead?: string; note?: string; badge?: string; tone?: 'plain' | 'warn' | 'off' };
export type FlowColumn = { title: string; nodes: FlowNode[] };

type Props = {
  label: string;
  columns: FlowColumn[];
  edges: FlowEdge[];
  picked: string | null;
  onPick: (id: string | null) => void;
  // What the picked node opens: under the map beside each other, under the node once the columns stack.
  detail: ReactNode;
  // The legend's words for each kind of line drawn.
  legend: Partial<Record<FlowKind, string>>;
};

const LINES: Record<FlowKind, string> = { follow: styles.follow!, own: styles.own!, gap: styles.gap!, off: styles.off! };
const TONES = { plain: undefined, warn: styles.warn, off: styles.muted };

type Drawn = { edge: FlowEdge; d: string; x: number; y: number };

// Curves from each node's right edge to the next column's left, measured from the laid-out nodes.
function useCurves(edges: readonly FlowEdge[], drawn: boolean) {
  const map = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLElement>());
  const [curves, setCurves] = useState<Drawn[]>([]);
  useLayoutEffect(() => {
    const frame = map.current;
    if (!drawn || !frame) return;
    const draw = () => {
      const box = frame.getBoundingClientRect();
      const at = (id: string) => nodes.current.get(id)?.getBoundingClientRect();
      setCurves(
        edges.flatMap((edge) => {
          const [from, to] = [at(edge.from), at(edge.to)];
          if (!from || !to) return [];
          const [x1, y1, x2, y2] = [from.right - box.left, from.top + from.height / 2 - box.top, to.left - box.left, to.top + to.height / 2 - box.top];
          const mid = (x1 + x2) / 2;
          return [{ edge, d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`, x: x2, y: y2 }];
        }),
      );
    };
    draw();
    const watch = new ResizeObserver(draw);
    watch.observe(frame);
    return () => watch.disconnect();
  }, [edges, drawn]);
  const place = (id: string) => (element: HTMLElement | null) => {
    if (element) nodes.current.set(id, element);
    else nodes.current.delete(id);
  };
  return { map, place, curves };
}

// Columns of nodes joined left to right by lines, each line's kind its own look; a node pressed lights the path
// through it and opens its detail, pressed again closes it.
export function FlowMap({ label, columns, edges, picked, onPick, detail, legend }: Props) {
  // Below --flow-stack the columns stack and each node names where its lines go instead.
  const [root, stacked] = useNarrowerThan<HTMLDivElement>('--flow-stack');
  const { map, place, curves } = useCurves(edges, !stacked);
  const lit = picked ? pathOf(edges, picked) : null;
  const titles = new Map(columns.flatMap(({ nodes }) => nodes.map(({ id, title, lead }) => [id, lead ?? title])));
  const onward = (id: string) =>
    edges
      .filter(({ from }) => from === id)
      .map(({ to }) => titles.get(to))
      .join(', ');
  const shown = useRef<HTMLDivElement>(null);
  // The detail opens past the map's foot or under a node far down: it is brought into view each time a node is picked.
  // A block body: scrollIntoView returns a promise in Chromium, which React would call as the cleanup.
  useLayoutEffect(() => {
    shown.current?.scrollIntoView({ block: 'nearest' });
  }, [picked]);
  const opened = picked !== null && detail && (
    <div ref={shown} className={styles.detail}>
      {detail}
    </div>
  );

  const node = ({ id, title, lead, note, badge, tone = 'plain' }: FlowNode) => (
    <button
      key={id}
      ref={place(id)}
      type="button"
      className={classNames(styles.node, TONES[tone], lit && (lit.has(id) ? styles.lit : styles.dim), id === picked && styles.picked)}
      aria-pressed={id === picked}
      onClick={() => onPick(id === picked ? null : id)}
    >
      {lead && <span className={styles.lead}>{lead}</span>}
      <span className={styles.head}>
        <span className={styles.title}>{title}</span>
        {badge && <Tag tone="faint">{badge}</Tag>}
      </span>
      {note && <span className={styles.note}>{note}</span>}
      {stacked && onward(id) && <span className={styles.onward}>→ {onward(id)}</span>}
    </button>
  );

  return (
    <div ref={root} className={styles.frame} role="group" aria-label={label}>
      <div ref={map} className={classNames(styles.map, stacked && styles.stacked)}>
        {!stacked && (
          <svg className={styles.lines} aria-hidden="true">
            {curves.map(({ edge, d, x, y }) => (
              <Fragment key={`${edge.from}>${edge.to}`}>
                <path className={classNames(styles.line, LINES[edge.kind], lit && (lit.has(edge.from) && lit.has(edge.to) ? styles.lit : styles.dim))} d={d} />
                {edge.label && (
                  <text className={styles.label} x={x - tokenPx('--flow-label-inset')} y={y - tokenPx('--flow-label-inset')} textAnchor="end">
                    {edge.label}
                  </text>
                )}
              </Fragment>
            ))}
          </svg>
        )}
        {columns.map((column) => (
          <section key={column.title} className={styles.column} aria-label={column.title}>
            <h4 className={styles.columnTitle}>{column.title}</h4>
            {column.nodes.map((each) => (
              <Fragment key={each.id}>
                {node(each)}
                {stacked && each.id === picked && opened}
              </Fragment>
            ))}
          </section>
        ))}
      </div>
      {!stacked && opened}
      <ul className={styles.legend}>
        {(Object.entries(legend) as [FlowKind, string][]).map(([kind, words]) => (
          <li key={kind}>
            <svg className={styles.swatch} aria-hidden="true">
              <line className={classNames(styles.line, LINES[kind])} x1="0" y1="50%" x2="100%" y2="50%" />
            </svg>
            {words}
          </li>
        ))}
      </ul>
    </div>
  );
}
