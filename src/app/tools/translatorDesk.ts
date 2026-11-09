import { useSyncExternalStore } from 'react';
import { ChangeSignal } from '../../change-signal';
import type { Session } from '../../runtime/session';
import type { TranslatorFailure } from '../../runtime/translate';

// text: what came before a stop or a failure, kept in view.
type Run =
  | { kind: 'idle' }
  | { kind: 'running'; text: string }
  | { kind: 'done'; text: string; cut: boolean }
  | { kind: 'stopped'; text: string }
  | { kind: 'failed'; text: string; failure: TranslatorFailure };

type Desk = { source: string; run: Run };

// 번역기's text and its last result, kept apart from its page, which Esc, a press beside the 도구 window or another tool
// closes; held in memory by the open session, so a lock or logout drops them.
const desks = new WeakMap<Session, Desk>();
const changes = new ChangeSignal();
const EMPTY: Desk = { source: '', run: { kind: 'idle' } };

export function useTranslatorDesk(session: Session) {
  const desk = useSyncExternalStore(changes.subscribe, () => desks.get(session) ?? EMPTY);
  // Read at the write: a translation still settling writes after its page is gone or opened again.
  const change = (next: Partial<Desk>) => {
    desks.set(session, { ...(desks.get(session) ?? EMPTY), ...next });
    changes.notify();
  };
  return { ...desk, setSource: (source: string) => change({ source }), setRun: (run: Run) => change({ run }) };
}
