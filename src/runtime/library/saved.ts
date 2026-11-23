import { moved } from '../../model/fields';
import type { ApiResult } from '../api';

export type Removed<T> = { item: T; at: number };

// A list of things saved under a name (디스플레이 프리셋, 토글 프리셋, 대화 프리셋). change: how its owner writes the list.
export const saved = <T extends { id: string }>(change: (change: (items: T[]) => T[]) => Promise<ApiResult<unknown>>) => ({
  add: (item: T) => change((items) => [...items, item]),

  edit: (id: string, patch: Partial<Omit<T, 'id'>>) => change((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item))),

  async remove(id: string): Promise<ApiResult<Removed<T>>> {
    let removed = null as Removed<T> | null;
    const done = await change((items) => {
      const at = items.findIndex((item) => item.id === id);
      removed = at < 0 ? null : { item: items[at]!, at };
      return items.filter((item) => item.id !== id);
    });
    if (!done.ok) return done;
    return removed ? { ok: true, data: removed } : { ok: false, error: 'gone' };
  },

  // Back where it stood; one already back is left as it is.
  restore: ({ item, at }: Removed<T>) => change((items) => (items.some(({ id }) => id === item.id) ? items : items.toSpliced(at, 0, item))),

  // The item ends where target was, before it when moved toward the front and after it when moved toward the back.
  move: (id: string, target: string) =>
    change((items) => {
      const from = items.findIndex((item) => item.id === id);
      const to = items.findIndex((item) => item.id === target);
      return from < 0 || to < 0 || from === to ? items : moved(items, from, to);
    }),
});
