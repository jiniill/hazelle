import type { FolderTree } from './folders';

// Apart from settings, which every chat's display reads: a move here leaves no chat to redisplay or summarize again.
export const ORDER_ID = '00000000-0000-4000-8000-000000000010';
// Absent only until the first open after it shipped writes it (runtime/characters seedOrder).
export type Order = { ids: string[] };

// Unknown ids sort by name before ordered ids, not by chat activity.
// Keep missing ids so undo restores their original positions.
export function arrange<T>(order: readonly string[], items: readonly T[], idOf: (item: T) => string, nameOf: (item: T) => string): T[] {
  const at = new Map(order.map((id, index) => [id, index]));
  const unnamed = items.filter((item) => !at.has(idOf(item))).sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ko'));
  const named = items.filter((item) => at.has(idOf(item))).sort((a, b) => at.get(idOf(a))! - at.get(idOf(b))!);
  return [...unnamed, ...named];
}

export const arrangeFolders = (order: readonly string[], folders: readonly FolderTree[]): FolderTree[] =>
  arrange(order, folders, ({ id }) => id, ({ value }) => value.name).map((folder) => ({ ...folder, children: arrangeFolders(order, folder.children) }));

// Reorder only the supplied ids in their existing slots; previously unlisted ids gain slots at the front.
export function rearrange(order: readonly string[], sequence: readonly string[]): string[] {
  const named = new Set(order);
  const moving = new Set(sequence);
  let next = 0;
  return [...sequence.filter((id) => !named.has(id)), ...order].map((id) => (moving.has(id) ? sequence[next++]! : id));
}

export function toFront(order: readonly string[], ids: readonly string[]): string[] {
  const moved = new Set(ids);
  return [...ids, ...order.filter((id) => !moved.has(id))];
}

// ids back where they stood in before, each ahead of the id that followed it there; the rest keep their order. One
// without a place in before goes out, as it was; one whose follower has gone, to the end.
export function putBack(order: readonly string[], before: readonly string[], ids: readonly string[]): string[] {
  const moving = new Set(ids);
  const rest = order.filter((id) => !moving.has(id));
  let next: string | null = null;
  const ahead = new Map<string | null, string[]>();
  for (const id of before.toReversed()) {
    if (moving.has(id)) ahead.set(next, [id, ...(ahead.get(next) ?? [])]);
    else next = id;
  }
  const kept = new Set(rest);
  const lost = [...ahead].flatMap(([follower, moved]) => (follower !== null && !kept.has(follower) ? moved : []));
  return [...rest.flatMap((id) => [...(ahead.get(id) ?? []), id]), ...lost, ...(ahead.get(null) ?? [])];
}

export function placeBefore(ids: readonly string[], id: string, before: string | null): string[] {
  const rest = ids.filter((each) => each !== id);
  rest.splice(before === null ? rest.length : rest.indexOf(before), 0, id);
  return rest;
}
