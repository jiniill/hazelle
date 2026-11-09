import { useSyncExternalStore } from 'react';
import { ChangeSignal } from '../../change-signal';
import type { ApiResult } from '../../runtime/api';
import { useToast, type Toasts } from '../toast';
import { namedObject, REMOVE_FAILED } from './words';

// name: read from what was deleted, which the queue (useAutosave's remove) saved its pending edits to first. then:
// leaving the deleted thing, before its 되돌리기 shows. detail: under the 되돌리기, such as BIN_KEEPS.
type Removal<T> = {
  name: (removed: T) => string;
  noun: string;
  task: () => Promise<ApiResult<T>>;
  queue?: <R extends { ok: boolean }>(task: () => Promise<R>) => Promise<R | null>;
  restore: (removed: T) => ReturnType<Parameters<Toasts['undoable']>[1]>;
  then?: () => void;
  detail?: string;
};

// The store shows a delete before the server answers it, so a page that leaves once the answer comes would read as
// deleted (Missing) until then. Counted, as two may be under way.
let leaving = 0;
const left = new ChangeSignal();
const shift = (by: 1 | -1) => {
  leaving += by;
  left.notify();
};

// Whether a removal that leaves its page is under way.
export const useLeaving = () => useSyncExternalStore(left.subscribe, () => leaving > 0);

// Deleting one thing: why it failed, or that it is gone with its 되돌리기. Resolves whether it is gone.
export function useRemoval() {
  const toast = useToast();
  return async <T>({ name, noun, task, queue, restore, then, detail }: Removal<T>): Promise<boolean> => {
    if (then) shift(1);
    try {
      const removed = queue ? await queue(task) : await task();
      if (!removed) return false;
      if (!removed.ok) {
        toast.failed(removed, REMOVE_FAILED);
        return false;
      }
      then?.();
      toast.undoable(`${namedObject(name(removed.data), noun)} 삭제했어요.`, () => restore(removed.data), detail);
      return true;
    } finally {
      if (then) shift(-1);
    }
  };
}
