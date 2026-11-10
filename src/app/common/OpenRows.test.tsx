import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useRowEdits } from './OpenRows';
import { REMOVE_FAILED } from './words';

const toast = { failed: vi.fn(), undoable: vi.fn() };
vi.mock('../toast', () => ({ useToast: () => toast }));

afterEach(() => vi.clearAllMocks());

it('closes a deleted row only once it is gone, after its queue, offering the 되돌리기 with its name', async () => {
  let rows: ReturnType<typeof useRowEdits>;
  const setOpen = vi.fn();
  function Probe() {
    rows = useRowEdits(setOpen);
    return null;
  }
  const root = probeRoot();
  act(() => root.render(<Probe />));
  const restore = vi.fn();
  type Task = () => Promise<{ ok: true; data: string } | { ok: false; error: string }>;
  const remove = (task: Task, queue: (run: Task) => ReturnType<Task> | Promise<null> = (run) => run()) =>
    rows.remove({ id: 'row', noun: '항목', name: '달빛', task, queue, restore });

  await remove(async () => ({ ok: false, error: 'gone' }));
  expect(toast.failed).toHaveBeenCalledWith({ ok: false, error: 'gone' }, REMOVE_FAILED);
  await remove(async () => ({ ok: true, data: '짝' }), async () => null);
  expect([setOpen.mock.calls, toast.undoable.mock.calls]).toEqual([[], []]);

  await remove(async () => ({ ok: true, data: '짝' }));
  expect(setOpen).toHaveBeenCalledExactlyOnceWith('row', false);
  expect(toast.undoable).toHaveBeenCalledWith("'달빛' 항목을 삭제했어요.", expect.any(Function), undefined);
  toast.undoable.mock.calls[0]![1]();
  expect(restore).toHaveBeenCalledWith('짝');
  act(() => root.unmount());
});
