import { useEffect, useRef, useState } from 'react';
import { draftTranslatorNote } from '../../runtime/tasks/translator-note';
import { describeTranslateFailure } from '../common/failure';
import { useSession } from '../session';
import { useToast } from '../toast';

// flush first: the draft reads the notes as stored (runtime/tasks/translator-note). One stopped by leaving the screen writes
// nothing.
export function useNoteDraft(id: string, flush: () => Promise<boolean>, append: (lines: string) => void) {
  const session = useSession();
  const toast = useToast();
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function start() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    // A note that did not save has its own toast, and a draft over the stored one would repeat what was typed.
    if (!(await flush())) {
      abort.current = null;
      return setRunning(false);
    }
    const made = await draftTranslatorNote(session, id, controller.signal);
    if (controller.signal.aborted) return;
    abort.current = null;
    setRunning(false);
    if (made.ok) append(made.text);
    else if (made.failure.kind !== 'stopped') toast.error('초안을 만들지 못했어요.', { detail: describeTranslateFailure(made.failure) });
  }

  return { running, start: () => void start() };
}
