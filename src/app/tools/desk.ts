import { useSyncExternalStore } from 'react';
import { ChangeSignal } from '../../change-signal';
import type { Session } from '../../runtime/session';

// A tool page's state, kept apart from its page, which Esc, a press beside the 도구 window or another tool closes;
// held in memory by the open session, so a lock or logout drops it.
export function toolDesk<Desk extends object>(empty: Desk) {
  const desks = new WeakMap<Session, Desk>();
  const changes = new ChangeSignal();
  return function useDesk(session: Session) {
    const desk = useSyncExternalStore(changes.subscribe, () => desks.get(session) ?? empty);
    // Read at the write: work still settling writes after its page is gone or opened again.
    const change = (next: Partial<Desk>) => {
      desks.set(session, { ...(desks.get(session) ?? empty), ...next });
      changes.notify();
    };
    return [desk, change] as const;
  };
}
