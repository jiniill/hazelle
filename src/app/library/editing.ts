type Queue = { flush: () => Promise<boolean> };
type Removal = <R extends { ok: boolean }>(task: () => Promise<R>) => Promise<R | null>;
export type Editing = { flush: () => Promise<boolean>; remove: Removal };

// Flush every queue before copy/removal; remove on the owner queue so no pending save resurrects it.
// Null means a failed save prevented removal and already reported itself.
export function editing(owner: Queue & { remove: Removal }, others: Queue[]): Editing {
  const written = async (queues: Queue[]) => (await Promise.all(queues.map((queue) => queue.flush()))).every(Boolean);
  return {
    flush: () => written([owner, ...others]),
    remove: async (task) => ((await written(others)) ? owner.remove(task) : null),
  };
}
