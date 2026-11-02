import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Shown } from '../../runtime/talk';
import { probeRoot } from '../ui/probe';
import { useMessageEdit } from './useMessageEdit';

vi.mock('../session', () => ({ useSession: () => ({}) }));
vi.mock('../toast', () => ({ useToast: () => ({ failed: vi.fn(), settled: vi.fn(), undoable: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const message = (id: string): Shown => ({ id, role: 'user', at: 1, selected: 0, live: null, versions: [{ id: `${id}:v`, seed: id, text: id, at: 1, receipt: null, edited: false }] });

it('ends an edit whose message left the chat from elsewhere', async () => {
  let edit: ReturnType<typeof useMessageEdit>;
  function Probe({ messages }: { messages: Shown[] }) {
    edit = useMessageEdit('chat', messages, () => {}, () => {});
    return null;
  }
  const [kept, gone] = [message('kept'), message('gone')];
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe messages={[kept, gone]} />));
    await act(() => edit!.actions.edit(gone, null));
    expect(edit!.editing?.id).toBe('gone');
    await act(() => root.render(<Probe messages={[kept]} />));
    expect(edit!.editing).toBeNull();
  } finally {
    await act(() => root.unmount());
  }
});
