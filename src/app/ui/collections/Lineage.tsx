import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { LineageCard } from './LineageCard';
import { placeRows, placeStems, type Metrics, type PlacedPill, type PlacedStem, type RowMetrics, type Sprout, type Stem } from './stems';
import styles from './Lineage.module.css';

// What a stem's head says, from its owner; where it stands in the family, the map adds.
export type LineageHead = { title: string; note?: string; preview?: string; control?: ReactNode; onClick?: () => void };

type Props = {
  root: Stem;
  label: string;
  head: (stem: Stem) => LineageHead;
  // The heads show their preview line.
  preview: boolean;
  // A pill pressed: the stem it stands on.
  onPill: (parent: Stem) => void;
};

// The sizes the lines are drawn with are the stylesheet's: the SVG and the placement take numbers.
const px = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
const headHeight = (preview: boolean) => px(preview ? '--lineage-head-preview' : '--lineage-head');
const mapMetrics = (preview: boolean): Metrics => ({ unit: px('--lineage-unit'), min: px('--lineage-line-min'), max: px('--lineage-line-max'), head: { width: px('--lineage-head-width'), height: headHeight(preview) }, gap: px('--lineage-gap'), drop: px('--lineage-drop'), pill: px('--lineage-pill-step'), endDrop: px('--lineage-end-drop') });
const rowMetrics = (preview: boolean): RowMetrics => ({ head: headHeight(preview), gap: px('--lineage-row-gap'), lane: px('--lineage-lane'), end: px('--lineage-gutter-end') });
const marks = () => ({ cap: px('--lineage-cap') / 2, tick: px('--lineage-tick') / 2, tickMin: px('--lineage-tick-min') });

const tagOf = (via: Sprout | null) => (via === null ? '원본' : via.kind === 'copy' ? '사본' : via.at === null ? '분기' : `${via.at}번째에서`);
const frameOf = (stem: Stem, via: Sprout | null) => (stem.ghost ? 'ghost' : via?.kind === 'copy' ? 'copy' : 'plain');
const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

// The map opens on the reader's own stem, which may stand past the panel's edge.
function useOwn() {
  const own = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    own.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, []);
  return own;
}

type HeadProps = { stem: Stem; via: Sprout | null; onPath: boolean; head: (stem: Stem) => LineageHead; preview: boolean; own: RefObject<HTMLLIElement | null>; style: CSSProperties };

// A head where its placement put it.
function Head({ stem, via, onPath, head, preview, own, style }: HeadProps) {
  const said = head(stem);
  return (
    <li ref={stem.current ? own : undefined} className={styles.head} style={style}>
      <LineageCard title={said.title} note={said.note} tag={stem.ghost ? undefined : tagOf(via)} preview={preview ? said.preview : undefined} variant={frameOf(stem, via)} current={stem.current} tone={onPath ? 'accent' : 'plain'} control={said.control} onClick={said.onClick} />
    </li>
  );
}

const PILLS = { branch: '', copy: styles.copyPill, unplaced: styles.unplacedPill };
const pillText = ({ kind, at }: PlacedPill['pill']) => (kind === 'branch' ? at : kind === 'copy' ? '사본' : '?');
const pillLabel = ({ kind, at, sprouts }: PlacedPill['pill']) => `${kind === 'branch' ? `${at}번째 메시지에서 분기` : kind === 'copy' ? '사본' : '분기 · 갈라진 메시지를 몰라요'}${sprouts.length > 1 ? ` ${sprouts.length}개` : ''}`;

// start: hung from its point by its start, not its middle, where the lane left of it is close (the list).
function Pill({ placed, start = false, onPill }: { placed: PlacedPill; start?: boolean; onPill: (parent: Stem) => void }) {
  const { pill, parent, x, y, onPath } = placed;
  const label = pillLabel(pill);
  const props = { className: classes(styles.pill, PILLS[pill.kind], onPath && styles.lit, start && styles.start), style: { left: x, top: y }, title: label, 'aria-label': label };
  // A ghost's pills have nothing to open.
  if (parent.ghost) {
    return (
      <span role="img" {...props}>
        {pillText(pill)}
      </span>
    );
  }
  return (
    <button type="button" {...props} onClick={() => onPill(parent)}>
      {pillText(pill)}
    </button>
  );
}

function Cap({ x, y, r, onPath, current }: { x: number; y: number; r: number; onPath: boolean; current: boolean }) {
  return <circle className={classes(styles.cap, onPath && styles.onPath, current && styles.current)} cx={x} cy={y} r={r} />;
}

function Legend() {
  return (
    <ul className={styles.legend} aria-label="범례">
      <li>
        <span className={styles.branchMark} aria-hidden />
        분기 · 숫자는 갈라진 메시지
      </li>
      <li>
        <span className={styles.copyMark} aria-hidden />
        사본
      </li>
      <li>
        <span className={styles.ghostMark} aria-hidden />
        삭제된 원본
      </li>
      <li className={styles.lit}>
        <span className={styles.pathMark} aria-hidden />
        지금 채팅까지의 길
      </li>
    </ul>
  );
}

// One tick every ten messages, or fifty, or a hundred: the first that keeps them the least room apart.
const TICK_EVERY = [10, 50, 100];
function ticks({ stem, from, to }: PlacedStem, least: number): number[] {
  const per = stem.length === 0 ? 0 : (to - from) / stem.length;
  const every = TICK_EVERY.find((n) => n * per >= least);
  if (every === undefined) return [];
  const ys: number[] = [];
  for (let n = every; n < stem.length; n += every) ys.push(from + n * per);
  return ys;
}

// Out of the pill sideways, into the child's head from above.
const across = (x: number, y: number, cx: number, cy: number) => `M ${x} ${y} C ${(x + cx) / 2} ${y}, ${cx} ${y}, ${cx} ${cy}`;
// Down from the pill, over into the child's lane and down into its node.
const down = (x: number, y: number, cx: number, cy: number) => `M ${x} ${y} C ${x} ${cy}, ${cx} ${y}, ${cx} ${cy}`;

export function Lineage({ root, label, head, preview, onPill }: Props) {
  const draw = useMemo(() => ({ metrics: mapMetrics(preview), ...marks() }), [preview]);
  const { width, height, stems, pills, sprouts } = useMemo(() => placeStems(root, draw.metrics), [root, draw]);
  const own = useOwn();
  // A branch at a stem's last message sits on the cap, its pill reading what the count would.
  const counted = new Set(pills.flatMap(({ pill, parent }) => (pill.kind === 'branch' && pill.at >= parent.length ? [parent.key] : [])));
  // The fade at the edge shows while more of the map stands past it.
  const scroll = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const check = useCallback(() => {
    const box = scroll.current;
    if (box) setMore(box.scrollWidth - box.clientWidth - box.scrollLeft > 1);
  }, []);
  useLayoutEffect(() => {
    check();
    const watch = new ResizeObserver(check);
    watch.observe(scroll.current!);
    return () => watch.disconnect();
  }, [check, width]);
  return (
    <div className={styles.frame}>
      <div className={styles.view}>
        <div ref={scroll} className={styles.canvas} onScroll={check}>
          <div className={classes(styles.map, preview && styles.withPreview)} style={{ width, height }}>
            <svg className={styles.lines} width={width} height={height} aria-hidden>
              {stems.map((placed) => {
                const { stem, x, from, to, onPath } = placed;
                return (
                  <g key={stem.key}>
                    <line className={classes(styles.stem, stem.ghost ? styles.ghost : onPath && styles.onPath)} x1={x} y1={from} x2={x} y2={to} />
                    {ticks(placed, draw.tickMin).map((y) => (
                      <line key={y} className={styles.tick} x1={x - draw.tick} y1={y} x2={x + draw.tick} y2={y} />
                    ))}
                    <Cap x={x} y={to} r={draw.cap} onPath={onPath} current={stem.current === true} />
                  </g>
                );
              })}
              {sprouts.map(({ sprout, pill, child, onPath }) => (
                <path key={child.stem.key} className={classes(styles.link, onPath && styles.onPath, sprout.kind === 'copy' && styles.dashed)} d={across(pill.x, pill.y, child.x, child.top)} />
              ))}
            </svg>
            <ul className={styles.heads} aria-label={label}>
              {stems.map(({ stem, via, x, top, onPath }) => (
                <Head key={stem.key} stem={stem} via={via} onPath={onPath} head={head} preview={preview} own={own} style={{ left: x - draw.metrics.head.width / 2, top, width: draw.metrics.head.width }} />
              ))}
            </ul>
            {stems.map(
              ({ stem, x, to, onPath }) =>
                !stem.ghost &&
                !counted.has(stem.key) && (
                  <span key={stem.key} className={classes(styles.count, onPath && styles.lit)} style={{ left: x, top: to }} aria-hidden>
                    {stem.length}
                  </span>
                ),
            )}
            {pills.map((placed) => (
              <Pill key={placed.pill.sprouts[0]!.stem.key} placed={placed} onPill={onPill} />
            ))}
          </div>
        </div>
        {more && <div className={styles.fade} aria-hidden />}
      </div>
      <Legend />
    </div>
  );
}

// The same family as rows down the panel, the lanes drawn in a gutter at their start.
export function LineageList({ root, label, head, preview, onPill }: Props) {
  const draw = useMemo(() => ({ metrics: rowMetrics(preview), ...marks() }), [preview]);
  const { width, height, rows, pills, links } = useMemo(() => placeRows(root, draw.metrics), [root, draw]);
  const own = useOwn();
  return (
    <div className={styles.frame}>
      <div className={styles.rows}>
        <div className={classes(styles.map, preview && styles.withPreview)} style={{ height }}>
          <svg className={styles.lines} width={width} height={height} aria-hidden>
            {rows.map(({ stem, x, y, to, onPath }) => (
              <g key={stem.key}>
                {to > y && <line className={classes(styles.stem, stem.ghost ? styles.ghost : onPath && styles.onPath)} x1={x} y1={y} x2={x} y2={to} />}
                <Cap x={x} y={y} r={draw.cap} onPath={onPath} current={stem.current === true} />
              </g>
            ))}
            {links.map(({ sprout, pill, child, onPath }) => (
              <path key={child.stem.key} className={classes(styles.link, onPath && styles.onPath, sprout.kind === 'copy' && styles.dashed)} d={down(pill.x, pill.y, child.x, child.y)} />
            ))}
          </svg>
          <ul className={styles.heads} aria-label={label}>
            {rows.map(({ stem, via, top, onPath }) => (
              <Head key={stem.key} stem={stem} via={via} onPath={onPath} head={head} preview={preview} own={own} style={{ left: width, right: 0, top }} />
            ))}
          </ul>
          {pills.map((placed) => (
            <Pill key={placed.pill.sprouts[0]!.stem.key} placed={placed} start onPill={onPill} />
          ))}
        </div>
      </div>
      <Legend />
    </div>
  );
}
