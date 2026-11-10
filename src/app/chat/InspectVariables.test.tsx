import { act, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Sending } from '../../runtime/turn-context';
import { probeRoot } from '../ui/probe';
import { Variables } from './InspectVariables';

const variables = vi.fn();
const said = vi.fn<(props: { children: ReactNode; action?: { label: string; onClick: () => void } }) => null>(() => null);
const model = { subscribe: () => () => {}, snapshot: () => null };
const session = { store: { evaluation: { variables } }, read: { chat: () => model } };
vi.mock('../session', () => ({ useSession: () => session }));
vi.mock('../toast', () => ({ useToast: () => ({}) }));
vi.mock('../../runtime/chat-context', () => ({ inspectToggles: () => [] }));
vi.mock('../common/useSearch', () => ({ useSearch: <T,>(found: T[]) => ({ field: null, none: null, found }) }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Stack: ({ children }: { children: ReactNode }) => children,
  Section: ({ children }: { children: ReactNode }) => children,
  Text: (props: { children: ReactNode }) => said(props),
  Empty: (props: { children: ReactNode }) => said(props),
  Callout: (props: { children: ReactNode; action?: { label: string; onClick: () => void } }) => said(props),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('says a failed read with 다시 시도 instead of hiding it, and reads again on it', async () => {
  const sending = { turn: { scope: {}, chat: {} } } as unknown as Sending;
  variables.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ variables: [], omitted: 0 });
  const root = probeRoot();
  try {
    await act(async () => root.render(<Variables chat="chat" sending={sending} busy={false} />));
    const failure = said.mock.lastCall![0];
    expect(failure.children).toBe('변수를 읽지 못했어요.');
    expect(failure.action?.label).toBe('다시 시도');
    await act(async () => failure.action!.onClick());
    expect(variables).toHaveBeenCalledTimes(2);
    expect(said.mock.lastCall![0].children).toBe('이 채팅에는 변수가 없어요.');
  } finally {
    await act(() => root.unmount());
  }
});
