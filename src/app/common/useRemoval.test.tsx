import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useRemoval } from './useRemoval';

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
  expect(toast.failed).toHaveBeenCalledWith({ ok: false, error: 'gone' }, '삭제하지 못했어요.');
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
