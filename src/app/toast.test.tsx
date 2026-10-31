import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { ToastProvider, useOwnUndo, useToast, type Toasts } from './toast';
import { probeRoot } from './ui/probe';

let shown: unknown[] = [];
let waiting = 0;
const report = vi.fn();
vi.mock('./ui', () => ({
  Toast: () => null,
  ToastStack: (props: { items: unknown[]; waiting: number }) => {
    shown = props.items;
    waiting = props.waiting;
    return null;
  },
}));

type Shown = { message: string; detail?: string; times?: number; action?: { onClick: () => void }; onClose?: () => void };
const props = () => (shown as { toast: { props: Shown } }[]).map(({ toast }) => toast.props);

function provider() {
  let toasts: Toasts;
  function Probe() {
    toasts = useToast();
    return null;
  }
  const root = probeRoot();
  return {
    toasts: () => toasts,
    start: () => act(() => root.render(<ToastProvider standing={null} onReport={report}><Probe /></ToastProvider>)),
    end: async () => {
      await act(() => root.unmount());
      vi.unstubAllGlobals();
    },
  };
}

it('takes a screen\'s own 되돌리기 away when the screen is left', async () => {
  let undoable: Toasts['undoable'];
  function Editor() {
    undoable = useOwnUndo();
    return null;
  }
  const root = probeRoot();
  const render = (open: boolean) => root.render(<ToastProvider standing={null} onReport={report}>{open && <Editor />}</ToastProvider>);
  try {
    await act(() => render(true));
    await act(() => void undoable!('블록을 뺐어요.', () => {}));
    expect(shown).toHaveLength(1);
    await act(() => render(false));
    expect(shown).toHaveLength(0);
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});

it('offers 오류 제보 on a failure, still counting one said again as one notice', async () => {
  const { toasts, start, end } = provider();
  try {
    await start();
    const failure = { ok: false, error: 'network' } as const;
    await act(() => toasts().failed(failure));
    await act(() => toasts().failed(failure));
    expect(props()).toHaveLength(1);
    expect(props()[0]!.times).toBe(2);
    await act(() => props()[0]!.action!.onClick());
    expect(report).toHaveBeenCalledOnce();
    expect(props()).toHaveLength(0);
  } finally {
    await end();
  }
});

it('counts a notice said again while it is up, a speaker\'s words too, but shows every 되돌리기', async () => {
  const { toasts, start, end } = provider();
  try {
    await start();
    await act(() => { toasts().show('계정을 복원해서 다시 열었어요'); toasts().show('계정을 복원해서 다시 열었어요'); });
    expect(props()).toEqual([expect.objectContaining({ times: 2 })]);
    const bot = { name: '코요미', face: null };
    await act(() => { toasts().said(bot, '호감도가 올랐어요', 'plain'); toasts().said(bot, '호감도가 올랐어요', 'plain'); });
    expect(props()[0]).toEqual(expect.objectContaining({ message: '호감도가 올랐어요', times: 2 }));
    await act(() => { toasts().undoable('삭제했어요', () => {}); toasts().undoable('삭제했어요', () => {}); });
    expect(props().map(({ message }) => message)).toEqual(['삭제했어요', '삭제했어요', '호감도가 올랐어요']);
  } finally {
    await end();
  }
});

it('lets a plain notice go past the three shown, but keeps a 되돌리기 waiting, its time stopped, until one ahead leaves', async () => {
  vi.useFakeTimers();
  const { toasts, start, end } = provider();
  try {
    await start();
    await act(() => { toasts().show('하나'); toasts().undoable('둘', () => {}); toasts().show('셋'); toasts().show('넷'); });
    expect(props().map(({ message }) => message)).toEqual(['넷', '셋', '둘']);
    await act(() => void toasts().show('다섯'));
    expect(props().map(({ message }) => message)).toEqual(['다섯', '넷', '셋']);
    expect(waiting).toBe(1);
    await act(() => { toasts().undoable('여섯', () => {}); toasts().undoable('일곱', () => {}); toasts().undoable('여덟', () => {}); });
    await act(() => vi.advanceTimersByTime(30_000));
    expect(props().map(({ message }) => message)).toEqual(['둘']);
    expect(waiting).toBe(0);
  } finally {
    await end();
    vi.useRealTimers();
  }
});

it('stops the notices\' time while the page is out of sight', async () => {
  vi.useFakeTimers();
  const { toasts, start, end } = provider();
  // probeRoot's stand-in document, given a visibility the test turns.
  let hidden = false;
  let seen = () => {};
  Object.defineProperty(document, 'hidden', { get: () => hidden });
  Object.assign(document, { addEventListener: (type: string, listener: () => void) => type === 'visibilitychange' && (seen = listener) });
  const look = (away: boolean) => act(() => {
    hidden = away;
    seen();
  });
  try {
    await start();
    await act(() => void toasts().show('저장했어요'));
    await look(true);
    await act(() => vi.advanceTimersByTime(60_000));
    await look(false);
    expect(shown).toHaveLength(1);
    await act(() => vi.advanceTimersByTime(10_000));
    expect(shown).toHaveLength(0);
  } finally {
    await end();
    vi.useRealTimers();
  }
});

it('says a 되돌리기 whose restore failed, with the one prefix', async () => {
  const { toasts, start, end } = provider();
  try {
    await start();
    await act(() => void toasts().undoable('삭제했어요', async () => ({ ok: false, error: 'gone' })));
    await act(async () => props()[0]!.action!.onClick());
    expect(props()).toEqual([expect.objectContaining({ message: '되돌리지 못했어요.', detail: expect.any(String) })]);
  } finally {
    await end();
  }
});
