import { act } from 'react';
import { expect, it, vi } from 'vitest';
import { copilot } from '../../connectors/copilot';
import { accountName, requestCode } from '../../runtime/account/sign-in';
import { probeRoot } from '../ui/probe';
import { useDeviceSignIn } from './useDeviceSignIn';

vi.mock('../toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('../../runtime/account/sign-in', () => ({ requestCode: vi.fn(), awaitApproval: vi.fn(), accountName: vi.fn() }));

it('connects with a pasted token in place of the code, dropping the code it was waiting on', async () => {
  let flow: AbortSignal | undefined;
  vi.mocked(requestCode).mockImplementation((_, signal) => ((flow = signal), new Promise(() => {})));
  vi.mocked(accountName).mockResolvedValue({ ok: true, name: 'octocat' });
  const approved = vi.fn(async () => null);
  let signIn: ReturnType<typeof useDeviceSignIn>;
  function Probe() {
    signIn = useDeviceSignIn(copilot.signIn!, approved);
    return null;
  }
  const root = probeRoot();
  act(() => root.render(<Probe />));
  expect(signIn!.stage).toEqual({ step: 'starting' });
  await act(async () => signIn.paste('gho_x'));
  expect(flow!.aborted).toBe(true);
  expect(requestCode).toHaveBeenCalledOnce();
  expect(accountName).toHaveBeenCalledWith(copilot.signIn, 'gho_x', expect.anything());
  expect(approved).toHaveBeenCalledWith('gho_x', 'octocat', expect.anything());
  expect(signIn!.stage).toEqual({ step: 'connecting' });
  act(() => root.unmount());
});
