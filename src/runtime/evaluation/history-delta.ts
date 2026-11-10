import type { HistoryMessage } from '../../engine/history';

export type Tail<T> = { from: number; items: T[] };
export function changedTail<T>(previous: readonly T[], next: readonly T[], same: (a: T, b: T) => boolean): Tail<T> {
  let from = 0;
  while (from < previous.length && from < next.length && same(previous[from]!, next[from]!)) from++;
  return { from, items: next.slice(from) };
}

// Prior revisions may still be executing; a replacement must not mutate their retained history arrays.
export const applyTail = <T>(previous: readonly T[], tail: Tail<T>): T[] => [...previous.slice(0, tail.from), ...tail.items];

const sameWrites = (a: [string, string][] | undefined, b: [string, string][] | undefined) => a === b || ((a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every(([key, value], at) => b![at]![0] === key && b![at]![1] === value));
const same = <T>(a: T, b: T) => a === b;
// Every field of HistoryMessage, which the type holds to the message's: one left out would keep a stale message in a
// lane's retained history.
const FIELDS: { [K in keyof HistoryMessage]-?: (a: HistoryMessage[K], b: HistoryMessage[K]) => boolean } = { id: same, message: same, seed: same, role: same, text: same, time: same, staged: same, before: sameWrites, after: sameWrites, byHand: sameWrites };
const compared = Object.entries(FIELDS) as [keyof HistoryMessage, (a: unknown, b: unknown) => boolean][];
export const sameHistory = (a: HistoryMessage, b: HistoryMessage) => a === b || compared.every(([key, equal]) => equal(a[key], b[key]));
