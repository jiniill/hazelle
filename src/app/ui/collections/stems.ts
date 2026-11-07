// A family of things as stems: each a line down from its head, as long as what it holds, its children sprouting from it.

export type Stem = { key: string; length: number; current?: boolean; ghost?: boolean; children: Sprout[] };
// at: the unit of the parent the child starts at, on a parent of length above 0; null hangs it from the parent's end.
// label: the sprout's name, read where its mark is pointed at.
export type Sprout = { kind: 'branch' | 'copy'; at: number | null; label: string; stem: Stem };

// Pixels: a unit's length, the bounds a line is clamped to, the head's box, the room between lanes and the drop
// from a sprout to the head under it.
export type Metrics = { unit: number; min: number; max: number; head: { width: number; height: number }; gap: number; drop: number };

// x: the line's; top: the head's; from and to: the line's ends.
export type PlacedStem = { stem: Stem; lane: number; x: number; top: number; from: number; to: number };
// y: where on the parent the child sprouts.
export type PlacedSprout = { sprout: Sprout; parent: PlacedStem; child: PlacedStem; y: number };
export type Placement = { width: number; height: number; stems: PlacedStem[]; sprouts: PlacedSprout[] };

type Held = { from: number; to: number };

const holdsCurrent = (stem: Stem): boolean => stem.current === true || stem.children.some(({ stem: child }) => holdsCurrent(child));

// Time runs down and siblings stand in lanes to the right of their parent. A child takes the nearest lane right of its
// parent's that is free from its sprout to its line's end, a drop clear of what the lane holds. The sprout leading to
// the current stem is placed first, so the reader's own line stays nearest; then the lowest sprout of a stem, so the
// lanes nearest the stem go to the sprouts whose run across is shortest.
export function placeStems(root: Stem, metrics: Metrics): Placement {
  const { unit, min, max, head, gap, drop } = metrics;
  const lanes: Held[][] = [];
  const stems: PlacedStem[] = [];
  const sprouts: PlacedSprout[] = [];
  const line = (stem: Stem) => Math.min(Math.max(stem.length * unit, min), max);
  const free = (lane: number, from: number, to: number) => (lanes[lane] ?? []).every((held) => to + drop <= held.from || from >= held.to + drop);
  const place = (stem: Stem, lane: number, top: number): PlacedStem => {
    const from = top + head.height;
    const placed = { stem, lane, x: lane * (head.width + gap) + head.width / 2, top, from, to: from + line(stem) };
    (lanes[lane] ??= []).push({ from: top, to: placed.to });
    stems.push(placed);
    const at = (sprout: Sprout) => (sprout.at === null ? placed.to : from + (placed.to - from) * Math.min(sprout.at / stem.length, 1));
    const order = (a: { sprout: Sprout; y: number }, b: { sprout: Sprout; y: number }) => Number(holdsCurrent(b.sprout.stem)) - Number(holdsCurrent(a.sprout.stem)) || b.y - a.y;
    for (const sprout of stem.children.map((sprout) => ({ sprout, y: at(sprout) })).sort(order)) {
      const childTop = sprout.y + drop;
      const end = childTop + head.height + line(sprout.sprout.stem);
      let next = lane + 1;
      while (!free(next, sprout.y, end)) next += 1;
      sprouts.push({ sprout: sprout.sprout, parent: placed, child: place(sprout.sprout.stem, next, childTop), y: sprout.y });
    }
    return placed;
  };
  place(root, 0, 0);
  return { width: lanes.length * (head.width + gap) - gap, height: Math.max(...stems.map(({ to }) => to)), stems, sprouts };
}
