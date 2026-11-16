import { act, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Receipt } from '../../model/chat';
import type { LogEntry } from '../../runtime/models/request-log';
import { probeRoot } from '../ui/probe';
import { Log } from './InspectLog';

const listed = vi.fn<(props: { title: string; expanded: boolean }) => null>(() => null);
const entry = (id: string, at: number) => ({ chat: 'chat', purpose: 'memory', at, picked: false, receipt: { id, modelName: 'm', state: 'done', usage: null } as unknown as Receipt, request: null, response: '{' }) as LogEntry;
let held = { entries: [entry('a', 1), entry('b', 2), entry('c', 3)], omitted: 4 };
vi.mock('../session', () => ({ useSession: () => ({ log: { subscribe: () => () => {}, of: () => held } }) }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  Section: ({ children }: { children: ReactNode }) => children,
  Stack: ({ children }: { children: ReactNode }) => children,
  List: ({ children }: { children: ReactNode }) => children,
  Text: () => null,
  ListItem: (props: { title: string; expanded: boolean }) => listed(props),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('opens the entry of the call it is given, showing it however old, so 응답 원문 보기 lands on that answer, and none without one', async () => {
  const root = probeRoot();
  try {
    await act(async () => root.render(<Log chat="chat" call="b" />));
    expect(listed.mock.calls.map(([props]) => props.expanded)).toEqual([false, true, false]);
    listed.mockClear();
    await act(async () => root.render(<Log key="none" chat="chat" call={undefined} />));
    expect(listed.mock.calls.every(([props]) => !props.expanded)).toBe(true);
    held = { entries: Array.from({ length: 30 }, (_, at) => entry(String(at), at)), omitted: 0 };
    listed.mockClear();
    await act(async () => root.render(<Log key="old" chat="chat" call="0" />));
    expect(listed.mock.calls.at(-1)![0].expanded).toBe(true);
  } finally {
    await act(() => root.unmount());
  }
});
