import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useMaking } from './useMaking';
import { COPY_SAID } from './words';

const toast = { failed: vi.fn(), settled: vi.fn(), show: vi.fn() };
vi.mock('../toast', () => ({ useToast: () => toast }));

afterEach(() => vi.clearAllMocks());

function probe() {
  let making: ReturnType<typeof useMaking>;
  function Probe() {
    making = useMaking();
    return null;
  }
  const root = probeRoot();
  act(() => root.render(<Probe />));
  return { making: () => making, root };
}

it('opens a new thing under the id it was made with, saying only why it could not be made', () => {
  const { making, root } = probe();
  const write = Promise.resolve({ ok: true as const, data: null });
  const make = vi.fn<(id: string) => typeof write>(() => write);
  const open = vi.fn();
  making().create('module', make, open);
  expect(open).toHaveBeenCalledExactlyOnceWith(make.mock.calls[0]![0]);
  expect(toast.settled).toHaveBeenCalledExactlyOnceWith(write, '모듈을 만들지 못했어요.');
  act(() => root.unmount());
});

it('copies only once the edits are stored, opening the copy before the server answers, then says how it went', async () => {
  const { making, root } = probe();
  const steps: string[] = [];
  let answer: (result: { ok: true; data: null } | { ok: false; error: 'gone' }) => void = () => {};
  let name = '루나';
  const copy = (flushed: boolean) =>
    making().copy({
      flush: async () => {
        name = '루나 2';
        steps.push('flush');
        return flushed;
      },
      name: () => name,
      make: (copied, id) => {
        steps.push(`make ${copied} ${id.length}`);
        return new Promise((resolve) => (answer = resolve));
      },
      open: () => steps.push('open'),
    });

  await copy(false);
  expect(steps).toEqual(['flush']);

  steps.length = 0;
  const made = copy(true);
  await vi.waitFor(() => expect(steps).toEqual(['flush', 'make 루나 2 (사본) 36', 'open']));
  expect(toast.show).not.toHaveBeenCalled();
  answer({ ok: true, data: null });
  await made;
  expect(toast.show).toHaveBeenCalledWith(COPY_SAID.made);

  const failed = copy(true);
  await vi.waitFor(() => expect(steps).toHaveLength(6));
  answer({ ok: false, error: 'gone' });
  await failed;
  expect(toast.failed).toHaveBeenCalledWith({ ok: false, error: 'gone' }, COPY_SAID.failed);
  act(() => root.unmount());
});
