// A family of things as stems: each a line down from its head, as long as what it holds, its children sprouting from it.
// Placed two ways: as a map (placeStems), time down and siblings in lanes to the right; and as rows (placeRows), one
// under another in family order with a lane per depth.

export type Stem = { key: string; length: number; current?: boolean; ghost?: boolean; children: Sprout[] };
// at: the unit of the parent the child starts at, on a parent of length above 0; null hangs it from the parent's end.
export type Sprout = { kind: 'branch' | 'copy'; at: number | null; stem: Stem };

// The mark the sprouts of one stem leave from: the unit they split at, a copy's, or a split whose unit is not known.
type Pill = ({ kind: 'branch'; at: number } | { kind: 'copy' | 'unplaced'; at: null }) & { sprouts: Sprout[] };
// parent: the stem it stands on; onPath: a sprout under it leads to the current stem.
export type PlacedPill = { pill: Pill; parent: Stem; x: number; y: number; onPath: boolean };

// Pixels: a unit's length, the bounds a line is clamped to, the head's box, the room between lanes, the drop from a pill
// to the head under it, the least room between two pills on one stem, and how far under a stem's end a pill hangs.
export type Metrics = { unit: number; min: number; max: number; head: { width: number; height: number }; gap: number; drop: number; pill: number; endDrop: number };

// x: the line's; top: the head's; from and to: the line's ends; via: the sprout it hangs from; onPath: on the way from
// the root to the current stem.
export type PlacedStem = { stem: Stem; lane: number; x: number; top: number; from: number; to: number; via: Sprout | null; onPath: boolean };
type PlacedSprout = { sprout: Sprout; pill: PlacedPill; child: PlacedStem; onPath: boolean };
export type Placement = { width: number; height: number; stems: PlacedStem[]; pills: PlacedPill[]; sprouts: PlacedSprout[] };

type Held = { from: number; to: number };

const holdsCurrent = (stem: Stem): boolean => stem.current === true || stem.children.some(({ stem: child }) => holdsCurrent(child));

const pillKey = ({ kind, at }: Sprout) => (kind === 'copy' ? 'copy' : at === null ? 'unplaced' : at);
// Down the stem: the splits by unit, then from its end the copies, then the branches whose split is not known.
const order = (pill: Pill): [number, number] => (pill.kind === 'branch' ? [0, pill.at] : [1, pill.kind === 'copy' ? 0 : 1]);

// A stem's sprouts under their pills, in order down the stem; sprouts of one unit share a pill.
function pillsOf(stem: Stem): Pill[] {
  const pills = new Map<string | number, Pill>();
  for (const sprout of stem.children) {
    const key = pillKey(sprout);
    const pill = pills.get(key) ?? (typeof key === 'number' ? { kind: 'branch', at: key, sprouts: [] } : { kind: key, at: null, sprouts: [] });
    pill.sprouts.push(sprout);
    pills.set(key, pill);
  }
  return [...pills.values()].sort((a, b) => {
    const [ka, va] = order(a);
    const [kb, vb] = order(b);
    return ka - kb || va - vb;
  });
}

// A child takes the nearest lane right of its parent's that is free from its pill to its line's end, a drop clear of
// what the lane holds. The sprout leading to the current stem is placed first, so the reader's own line stays nearest;
// then the lowest pill's, so the lanes nearest the stem go to the sprouts whose run across is shortest. Pills keep
// their order down the stem and at least `pill` apart, the later one pushed down.
export function placeStems(root: Stem, metrics: Metrics): Placement {
  const { unit, min, max, head, gap, drop, pill: step, endDrop } = metrics;
  const lanes: Held[][] = [];
  const stems: PlacedStem[] = [];
  const pills: PlacedPill[] = [];
  const sprouts: PlacedSprout[] = [];
  const line = (stem: Stem) => Math.min(Math.max(stem.length * unit, min), max);
  const free = (lane: number, from: number, to: number) => (lanes[lane] ?? []).every((held) => to + drop <= held.from || from >= held.to + drop);
  const place = (stem: Stem, lane: number, top: number, via: Sprout | null): PlacedStem => {
    const from = top + head.height;
    const to = from + line(stem);
    const placed: PlacedStem = { stem, lane, x: lane * (head.width + gap) + head.width / 2, top, from, to, via, onPath: holdsCurrent(stem) };
    let last = -Infinity;
    const own = pillsOf(stem).map((pill): PlacedPill => {
      const natural = pill.kind === 'branch' ? from + (to - from) * Math.min(pill.at / stem.length, 1) : to + endDrop;
      last = Math.max(natural, last + step);
      return { pill, parent: stem, x: placed.x, y: last, onPath: pill.sprouts.some((sprout) => holdsCurrent(sprout.stem)) };
    });
    (lanes[lane] ??= []).push({ from: top, to: Math.max(to, last) });
    stems.push(placed);
    pills.push(...own);
    const hung = own.flatMap((pill) => pill.pill.sprouts.map((sprout) => ({ sprout, pill, onPath: holdsCurrent(sprout.stem) })));
    for (const { sprout, pill, onPath } of hung.sort((a, b) => Number(b.onPath) - Number(a.onPath) || b.pill.y - a.pill.y)) {
      const childTop = pill.y + drop;
      let next = lane + 1;
      while (!free(next, pill.y, childTop + head.height + line(sprout.stem))) next += 1;
      sprouts.push({ sprout, pill, child: place(sprout.stem, next, childTop, sprout), onPath });
    }
    return placed;
  };
  place(root, 0, 0, null);
  return { width: lanes.length * (head.width + gap) - gap, height: Math.max(...stems.map(({ to }) => to), ...pills.map(({ y }) => y)), stems, pills, sprouts };
}

// Pixels: a row's height and the gap under it, the lanes' pitch (the first lane one pitch in), and the room after
// the deepest lane for its pills.
export type RowMetrics = { head: number; gap: number; lane: number; end: number };

// index: its place in family order; x and y: its node's; to: where its lane's line ends, at the last of its sprouts'
// pills, or at its node when it has none.
type PlacedRow = { stem: Stem; lane: number; index: number; top: number; x: number; y: number; to: number; via: Sprout | null; onPath: boolean };
type PlacedLink = { sprout: Sprout; pill: PlacedPill; parent: PlacedRow; child: PlacedRow; onPath: boolean };
export type RowPlacement = { width: number; height: number; rows: PlacedRow[]; pills: PlacedPill[]; links: PlacedLink[] };

// Rows in family order: a stem, then each of its sprouts' subtrees in pill order. A lane per depth, so the rows between
// a stem and a later sprout of its hold only deeper lanes, which leaves its own lane clear for the link down: the link
// leaves the parent's lane in the gap above the child's row, where the pill stands, one per sprout.
export function placeRows(root: Stem, metrics: RowMetrics): RowPlacement {
  const { head, gap, lane: pitch, end } = metrics;
  const rows: PlacedRow[] = [];
  const pills: PlacedPill[] = [];
  const links: PlacedLink[] = [];
  const walk = (stem: Stem, lane: number, via: Sprout | null): PlacedRow => {
    const top = rows.length * (head + gap);
    const row: PlacedRow = { stem, lane, index: rows.length, top, x: (lane + 1) * pitch, y: top + head / 2, to: top + head / 2, via, onPath: holdsCurrent(stem) };
    rows.push(row);
    for (const pill of pillsOf(stem)) {
      for (const sprout of pill.sprouts) {
        const onPath = holdsCurrent(sprout.stem);
        const placed: PlacedPill = { pill: { ...pill, sprouts: [sprout] }, parent: stem, x: row.x, y: rows.length * (head + gap) - gap / 2, onPath };
        pills.push(placed);
        row.to = placed.y;
        links.push({ sprout, pill: placed, parent: row, child: walk(sprout.stem, lane + 1, sprout), onPath });
      }
    }
    return row;
  };
  walk(root, 0, null);
  return { width: Math.max(...rows.map(({ x }) => x)) + end, height: rows.length * (head + gap) - gap, rows, pills, links };
}
