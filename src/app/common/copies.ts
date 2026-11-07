// How a list reads what was copied or branched from what: a prompt's copies, a chat's branches.
export type Copied<T> = { id: (item: T) => string; origin: (item: T) => string | undefined; folder: (item: T) => string | null };

export type Grouped<T> = { top: T[]; copies: ReadonlyMap<string, T[]> };

// Each group keeps the list's order; a copy of a copy is in its own copy's group, so the nesting recurses.
export function groupCopies<T>(items: readonly T[], of: Copied<T>): Grouped<T> {
  const byId = new Map(items.map((item) => [of.id(item), item]));
  const top: T[] = [];
  const copies = new Map<string, T[]>();
  // A copy sits under its original while that is still here, in the same folder: one filed elsewhere (moved while
  // its original was in 휴지통) stays in its own folder.
  for (const item of items) {
    const originId = of.origin(item);
    const origin = originId !== undefined && byId.get(originId);
    if (!origin || of.folder(origin) !== of.folder(item)) {
      top.push(item);
      continue;
    }
    const group = copies.get(of.id(origin));
    if (group) group.push(item);
    else copies.set(of.id(origin), [item]);
  }
  return { top, copies };
}

// A row stands for its copies too, which are shown under it: the latest moment among them places it, and those with
// none keep their order after the rest.
export function latestFirst<T>({ id }: Pick<Copied<T>, 'id'>, at: (item: T) => number | null, copies: ReadonlyMap<string, readonly T[]>) {
  const last = (item: T): number => Math.max(at(item) ?? -1, ...(copies.get(id(item)) ?? []).map(last));
  return (a: T, b: T) => last(b) - last(a);
}
