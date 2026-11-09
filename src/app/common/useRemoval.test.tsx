import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useLeaving, useRemoval } from './useRemoval';
import { REMOVE_FAILED } from './words';

const toast = { failed: vi.fn(), undoable: vi.fn() };
vi.mock('../toast', () => ({ useToast: () => toast }));

afterEach(() => vi.clearAllMocks());

it('says why a delete failed, else leaves and offers the 되돌리기 with what was deleted', async () => {
  let removal: ReturnType<typeof useRemoval>;
  function Probe() {
    removal = useRemoval();
    return null;
  }
  const root = probeRoot();
  act(() => root.render(<Probe />));
  const then = vi.fn();
  const restore = vi.fn();
  const remove = (task: () => Promise<{ ok: true; data: string } | { ok: false; error: string }>) =>
    removal({ name: (removed) => removed, noun: '프롬프트', task, restore, then, detail: '휴지통' });

  expect(await remove(async () => ({ ok: false, error: 'gone' }))).toBe(false);
  expect(toast.failed).toHaveBeenCalledWith({ ok: false, error: 'gone' }, REMOVE_FAILED);
  expect(then).not.toHaveBeenCalled();

  expect(await remove(async () => ({ ok: true, data: '짝' }))).toBe(true);
  expect(then).toHaveBeenCalledOnce();
  expect(toast.undoable).toHaveBeenCalledWith("'짝' 프롬프트를 삭제했어요.", expect.any(Function), '휴지통');
  toast.undoable.mock.calls[0]![1]();
  expect(restore).toHaveBeenCalledWith('짝');

  expect(await removal!({ name: () => '', noun: '연결', task: async () => ({ ok: true, data: null }), queue: async () => null, restore })).toBe(false);
  expect(toast.undoable).toHaveBeenCalledOnce();
  act(() => root.unmount());
});

it('reads as leaving while a removal that leaves its page waits for its answer, and not after, nor for one that stays', async () => {
  let removal: ReturnType<typeof useRemoval>;
  let leaving: boolean;
  function Probe() {
    removal = useRemoval();
    leaving = useLeaving();
    return null;
  }
  const root = probeRoot();
  act(() => root.render(<Probe />));
  let answer: (result: { ok: true; data: string }) => void;
  const task = () => new Promise<{ ok: true; data: string }>((resolve) => (answer = resolve));
  const left: boolean[] = [];
  let removed: Promise<boolean>;
  act(() => {
    removed = removal({ name: (name) => name, noun: '모듈', task, restore: vi.fn(), then: () => left.push(leaving) });
  });
  expect(leaving!).toBe(true);
  await act(async () => {
    answer({ ok: true, data: '짝' });
    await removed;
  });
  expect([left, leaving!]).toEqual([[true], false]);

  act(() => {
    removed = removal({ name: (name) => name, noun: '모듈', task, restore: vi.fn() });
  });
  expect(leaving!).toBe(false);
  await act(async () => {
    answer({ ok: true, data: '짝' });
    await removed;
  });
  act(() => root.unmount());
});
