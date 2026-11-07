import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Shown } from '../../runtime/talk';
import { editShown } from '../../runtime/message-acts';
import { probeRoot } from '../ui/probe';
import { useMessageEdit } from './useMessageEdit';

vi.mock('../../runtime/message-acts', () => ({ editShown: vi.fn(async () => ({ ok: true })) }));
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

it('removes a part as a saved edit that empties its lines on the side it is on', async () => {
  let edit: ReturnType<typeof useMessageEdit>;
  const edited = vi.fn();
  function Probe({ messages }: { messages: Shown[] }) {
    edit = useMessageEdit('chat', messages, () => {}, edited);
    return null;
  }
  const reply: Shown = { ...message('reply'), versions: [{ id: 'v', seed: 'v', text: 'a\nb', at: 1, receipt: null, edited: false, translation: { text: '가\n나\n다', receipt: null, at: 1 } }] };
  vi.stubGlobal('crypto', { randomUUID: () => 'next' });
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe messages={[reply]} />));
    await act(() => edit!.actions.removePart(reply, { from: 1, to: 1, side: 'translation', shown: { from: 1, to: 1 } }));
    expect(vi.mocked(editShown).mock.calls).toEqual([[{}, 'chat', reply, 'a\nb', '가\n다', 'next']]);
    expect(edited).toHaveBeenCalledWith('v', 'next');
  } finally {
    await act(() => root.unmount());
  }
});
