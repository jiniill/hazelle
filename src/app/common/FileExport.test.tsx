import { act, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { FileExport } from './FileExport';

const output = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
const toast = { show: vi.fn(), error: vi.fn(), failed: vi.fn() };
let press: () => void = () => {};
vi.mock('./download', () => ({ downloadOutput: async () => output }));
vi.mock('../toast', () => ({ useToast: () => toast }));
vi.mock('../ui', () => ({
  Dialog: ({ actions }: { actions: ReactNode }) => actions,
  Button: ({ onClick }: { onClick: () => void }) => {
    press = onClick;
    return null;
  },
  Section: () => null,
  Callout: () => null,
  Text: () => null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('writes on the press, shows what done says and closes only when the write succeeds', async () => {
  const root = probeRoot();
  const onClose = vi.fn();
  const write = vi.fn(async () => ({ ok: true as const, data: 2 }));
  const done = (tools: number) => ({ message: '내보냈어요.', detail: `${tools}개` });
  act(() => root.render(<FileExport format="Risu 모듈" file="a.risum" help="" blocked={null} write={write} done={done} onClose={onClose} />));

  await act(async () => press());
  expect(write).toHaveBeenCalledWith(output, expect.any(Function));
  expect(toast.show).toHaveBeenCalledWith('내보냈어요.', { detail: '2개' });
  expect(onClose).toHaveBeenCalledOnce();

  write.mockResolvedValueOnce({ ok: false, error: 'stopped' } as never);
  await act(async () => press());
  expect(onClose).toHaveBeenCalledOnce();
  act(() => root.unmount());
});
