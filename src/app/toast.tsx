import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApiFailure } from '../runtime/api';
import { noteProblem } from '../runtime/diagnostics';
import { describeFailure } from './common/failure';
import { UNDO } from './common/words';
import { SHORTCUTS, typing, useShortcut } from './shortcuts';
import { Toast, ToastStack, type ToastAction } from './ui';

type Action = { label: string; onClick: () => void };
type Extra = { detail?: string; action?: Action };
type From = { name: string; face: string | null };
// ends: null while it waits behind the notices shown, its time not yet running; Infinity once kept open.
type Notice = { key: number; message: string; detail?: string; tone: 'plain' | 'warn'; action?: ToastAction; said?: { from: From; keep: () => void }; close: () => void; undo: boolean; times: number; life: number; ends: number | null };

export type Toasts = {
  show: (message: string, extra?: Extra) => void;
  error: (message: string, extra?: Extra) => void;
  // Full-account/rewind notices are owned by Workspace, not repeated per write.
  // Prefixed task failures (e.g. backups) still need their own outcome.
  failed: (failure: ApiFailure, prefix?: string, words?: Parameters<typeof describeFailure>[1]) => void;
  // Delete immediately with undo, never confirmation. Return undo failures to the toast instead of chaining them silently.
  undoable: (message: string, undo: () => void | Promise<{ ok: true } | ApiFailure>, detail?: string) => () => void;
  // Long ones are cut until pressed, and once opened stay until closed.
  said: (from: From, text: string, tone: Notice['tone']) => void;
};

// More would only stack edges nobody reads. Past them a plain notice is let go, but a 되돌리기, a fix or someone's words
// waits its turn.
const KEPT = 3;
const waits = (notice: Notice) => notice.action !== undefined || notice.said !== undefined;

// A notice that comes up front starts its time, and one pushed back stops it, to start again when it comes up; one kept
// open stays kept.
function lineUp(all: Notice[]): Notice[] {
  const now = Date.now();
  const placed = (notice: Notice, index: number) => {
    if (index < KEPT) return notice.ends === null ? { ...notice, ends: now + notice.life } : notice;
    return notice.ends === null || notice.ends === Infinity ? notice : { ...notice, ends: null };
  };
  return all.filter((notice, index) => index < KEPT || waits(notice)).map(placed);
}

function lifeOf(tone: Notice['tone'], text: string, action: boolean): number {
  const base = tone === 'warn' ? 7000 : action ? 6000 : 4000;
  return Math.min(base + text.length * 40, tone === 'warn' ? 14000 : 10000);
}

const ToastContext = createContext<Toasts | null>(null);
const FloorContext = createContext<((floor: HTMLElement | null) => void) | null>(null);

export type Standing = { message: string; detail: string };

// Pause timers on hover/focus or hidden page; resume remaining time, never reset it.
// standing is caller-owned and never timed.
export function ToastProvider({ standing, children }: { standing: Standing | null; children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const [floor, setFloor] = useState<HTMLElement | null>(null);
  const toasts = useMemo<Toasts>(() => {
    let next = 0;
    const add = (message: string, tone: Notice['tone'], { detail, action, from }: Extra & { from?: From } = {}, undo = false) => {
      const key = ++next;
      if (tone === 'warn') noteProblem(detail ? `${message} ${detail}` : message);
      const life = lifeOf(tone, `${message}${detail ?? ''}`, action !== undefined);
      const close = () => setNotices((all) => lineUp(all.filter((notice) => notice.key !== key)));
      const keep = () => setNotices((all) => all.map((notice) => (notice.key === key ? { ...notice, ends: Infinity } : notice)));
      const pressed = action && { ...action, onClick: () => (close(), action.onClick()), ...(undo && { keys: SHORTCUTS.undoToast.keys }) };
      // The same words from the same speaker, said again while up, stay one notice that counts them and runs its time
      // again. One with an action is never merged: each carries its own 되돌리기.
      const repeats = (notice: Notice) => !action && !notice.action && notice.message === message && notice.detail === detail && notice.tone === tone && notice.said?.from.name === from?.name;
      setNotices((all) => {
        const same = all.find(repeats);
        const again = (notice: Notice) => ({ ...notice, times: notice.times + 1, ends: notice.ends === null ? null : Math.max(notice.ends, Date.now() + life) });
        return lineUp(same ? all.map((notice) => (notice === same ? again(notice) : notice)) : [{ key, message, detail, tone, action: pressed, said: from && { from, keep }, close, undo, times: 1, life, ends: null }, ...all]);
      });
      return close;
    };
    const failed: Toasts['failed'] = (failure, prefix, words) => {
      if (failure.error !== 'storage-full' && (failure.error !== 'timeline-changed' || prefix)) add(prefix ?? describeFailure(failure, words), 'warn', prefix ? { detail: describeFailure(failure, words) } : {});
    };
    const settle = (undo: Parameters<Toasts['undoable']>[1]) => () => void undo()?.then((result) => result.ok || failed(result, '되돌리지 못했어요.'));
    return {
      show: (message, extra) => void add(message, 'plain', extra),
      error: (message, extra) => void add(message, 'warn', extra),
      failed,
      undoable: (message, undo, detail) => add(message, 'plain', { detail, action: { label: UNDO, onClick: settle(undo) } }, true),
      said: (from, text, tone) => void add(text, tone, { from }),
    };
  }, []);

  useEffect(() => {
    const seen = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, []);

  const stopped = held || hidden;
  useEffect(() => {
    if (!stopped) return;
    const since = Date.now();
    return () => {
      const gap = Date.now() - since;
      setNotices((all) => all.map((notice) => (notice.ends === null ? notice : { ...notice, ends: notice.ends + gap })));
    };
  }, [stopped]);

  useEffect(() => {
    if (stopped) return;
    const soonest = Math.min(...notices.map(({ ends }) => ends ?? Infinity));
    // Only notices kept open or waiting are left, and those have no end yet.
    if (soonest === Infinity) return;
    const timer = setTimeout(() => setNotices((all) => lineUp(all.filter(({ ends }) => ends === null || ends > Date.now()))), Math.max(0, soonest - Date.now()));
    return () => clearTimeout(timer);
  }, [stopped, notices]);

  const shown = notices.slice(0, KEPT);
  // The newest 되돌리기 on screen; typing keeps the field's own undo.
  useShortcut('undoToast', (event) => {
    const newest = shown.find(({ undo }) => undo);
    if (typing(event) || !newest) return false;
    newest.action!.onClick();
  });

  return (
    <ToastContext.Provider value={toasts}>
      <FloorContext.Provider value={setFloor}>{children}</FloorContext.Provider>
      <ToastStack
        items={[
          ...(standing ? [{ key: 'standing', toast: <Toast message={standing.message} detail={standing.detail} tone="plain" life={0} paused={stopped} /> }] : []),
          ...shown.map(({ key, message, detail, tone, action, said, close, times, life }) => ({
            key,
            toast: <Toast message={message} detail={detail} tone={tone} action={action} times={times} from={said?.from} onKeep={said?.keep} onClose={close} life={life} paused={stopped} />,
            onClose: close,
          })),
        ]}
        waiting={notices.length - shown.length}
        held={held}
        onHold={setHeld}
        floor={floor}
      />
    </ToastContext.Provider>
  );
}

// The ref for what the toasts stand above while it is on screen: the chat's composer.
export function useToastFloor(): (floor: HTMLElement | null) => void {
  const setFloor = useContext(FloorContext);
  if (!setFloor) throw new Error('useToastFloor outside ToastProvider');
  return setFloor;
}

export function useToast(): Toasts {
  const toasts = useContext(ToastContext);
  if (!toasts) throw new Error('useToast outside ToastProvider');
  return toasts;
}

// Editor-history undo dies with its screen so it cannot mutate hidden drafts.
// Store-level undo (e.g. restore deleted items) may outlive screens through useToast.
export function useOwnUndo(): Toasts['undoable'] {
  const toasts = useToast();
  const [offered] = useState(() => new Set<() => void>());
  useEffect(
    () => () => {
      for (const withdraw of offered) withdraw();
      offered.clear();
    },
    [offered],
  );
  return (message, undo, detail) => {
    const withdraw = toasts.undoable(message, undo, detail);
    offered.add(withdraw);
    return withdraw;
  };
}
