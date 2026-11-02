export function without<T extends object>(from: T, key: keyof T): T {
  const rest = { ...from };
  delete rest[key];
  return rest;
}

// Each key's items in the order they came.
export function grouped<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

// to counts in the list without the items moved.
export function moved<T>(items: readonly T[], from: number, to: number, count = 1): T[] {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, count));
  return next;
}
