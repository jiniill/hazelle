import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useToldFailures } from './useToldFailures';

const toast = { error: vi.fn() };
vi.mock('../toast', () => ({ useToast: () => toast }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

type Entry = { chat: string; failure: string | null };

it('says each failure of this chat once, once meaning what the key says', async () => {
  const byEntry = new WeakSet<Entry>();
  const byChat = new Set<string>();
  function Probe({ jobs }: { jobs: ReadonlyMap<string, Entry> }) {
    useToldFailures(jobs, 'chat', { told: byEntry, failures: (entry) => [entry.failure], key: (_, entry) => entry, describe: (failure) => `entry ${failure}` });
    useToldFailures(jobs, 'chat', { told: byChat, failures: (entry) => [entry.failure], key: () => 'chat', describe: (failure) => `chat ${failure}` });
    return null;
  }
  const first: Entry = { chat: 'chat', failure: 'a' };
  const second: Entry = { chat: 'chat', failure: 'b' };
  const elsewhere: Entry = { chat: 'other', failure: 'c' };
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe jobs={new Map([['1', first], ['3', elsewhere]])} />));
    expect(toast.error.mock.calls).toEqual([['entry a'], ['chat a']]);
    await act(() => root.render(null));
    await act(() => root.render(<Probe jobs={new Map([['1', first], ['2', second], ['4', { chat: 'chat', failure: null }]])} />));
    expect(toast.error.mock.calls).toEqual([['entry a'], ['chat a'], ['entry b']]);
  } finally {
    await act(() => root.unmount());
  }
});
