import { useEffect } from 'react';
import { useToast } from '../toast';

// What a toast already said. The caller keeps it at module level, so a chat left and opened again is not told again.
type Told<Key> = { has(key: Key): boolean; add(key: Key): unknown };

type Telling<Entry, Failure, Key> = {
  told: Told<Key>;
  failures: (entry: Entry) => readonly (Failure | null | undefined)[];
  // What "once" means for this job: a failure whose key was told says nothing.
  key: (failure: Failure, entry: Entry) => Key;
  describe: (failure: Failure) => string;
};

// The failures of a background job's entries in this chat, each said once as an error toast.
export function useToldFailures<Entry extends { chat: string }, Failure, Key>(jobs: ReadonlyMap<string, Entry>, chatId: string, { told, failures, key, describe }: Telling<Entry, Failure, Key>) {
  const toast = useToast();
  useEffect(() => {
    for (const entry of jobs.values()) {
      if (entry.chat !== chatId) continue;
      for (const failure of failures(entry)) {
        if (!failure) continue;
        const once = key(failure, entry);
        if (told.has(once)) continue;
        told.add(once);
        toast.error(describe(failure));
      }
    }
  }, [jobs]);
}
