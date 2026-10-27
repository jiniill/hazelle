import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useSaves } from '../session';
import { useToast } from '../toast';
import type { SaveStatus, Write } from './saveQueue';

const SAVE_STATUS: Record<SaveStatus, string> = { saving: '저장 중', saved: '저장됨', failed: '저장 못 함' };

export const saveWords = (status: SaveStatus | null) => (status ? SAVE_STATUS[status] : undefined);

// One screen saving through several queues says the worst of them: a failure, else a save under way.
export const mergeStatus = (...statuses: (SaveStatus | null)[]) =>
  statuses.find((each) => each === 'failed') ?? statuses.find((each) => each === 'saving') ?? statuses.find((each) => each !== null) ?? null;

// Use the same session save key on every editor of an object; unsaved includes preceding screens' pending edits.
export function useAutosave<T extends object>(key: string, write: Write<T>) {
  const toast = useToast();
  const saves = useSaves();
  const latest = useRef(write);
  latest.current = write;
  const subscribe = useCallback((listener: () => void) => saves.watch(key, listener), [saves, key]);
  const view = useSyncExternalStore(subscribe, () => saves.view<T>(key));
  useEffect(() => () => void saves.flush(key), [saves, key]);

  const queue = () => saves.queue<T>(key, (patch) => latest.current(patch), (failure) => toast.failed(failure, '저장하지 못했어요.'));
  return {
    ...view,
    words: saveWords(view.status),
    change: (patch: Partial<T>, valid?: boolean) => queue().change(patch, valid),
    save: (patch: Partial<T>) => queue().save(patch),
    flush: () => saves.flush(key),
    remove: <R extends { ok: boolean }>(task: () => Promise<R>) => queue().remove(task),
  };
}
