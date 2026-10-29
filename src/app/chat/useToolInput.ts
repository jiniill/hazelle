import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session';
import { useToast } from '../toast';

// A //@input item's run. The draft is held while it runs and the text it answers replaces it, 되돌리기 putting back the
// text from before the press. 멈추기 or leaving the chat aborts the run, its model and network calls with it.
// where: the draft's key by now, as a send's putBack finds it; a new chat's moves under its id once saved.
export function useToolInput(chatId: string, where: () => string, saved: () => Promise<boolean>) {
  const { drafts, scriptCommands, scriptJournal } = useSession();
  const toast = useToast();
  const [running, setRunning] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => {
    current.current?.abort();
    current.current = null;
    setRunning(null);
  }, [chatId]);

  async function run(module: string, item: string) {
    if (current.current) return;
    const stop = new AbortController();
    current.current = stop;
    setRunning(module);
    try {
      const before = drafts.text(where());
      if (!(await saved())) return;
      const answer = await scriptCommands.input(chatId, module, item, before, stop.signal);
      if (answer === null || answer === before || stop.signal.aborted) return;
      const key = where();
      drafts.set(key, answer);
      toast.undoable('입력창 내용을 바꿨어요.', () => drafts.set(key, before));
    } catch (error) {
      scriptJournal.report(chatId, error, { kind: 'module', id: module });
    } finally {
      if (current.current === stop) {
        current.current = null;
        setRunning(null);
      }
    }
  }

  return { running, run, stop: () => current.current?.abort() };
}
