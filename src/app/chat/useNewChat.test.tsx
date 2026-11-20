import { act } from 'react';
import { shown, type ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { afterEach, expect, it, vi } from 'vitest';
import { navigate } from '../shell/router';
import { probeRoot } from '../ui/probe';
import { useNewChat } from './useNewChat';

let projected: () => void = () => {};
const session = { store: { projections: { evaluate: () => new Promise<void>((resolve) => (projected = resolve)) } }, drafts: { move: vi.fn() } };
vi.mock('../session', () => ({ useSession: () => session }));
vi.mock('../../runtime/chat/chat-log', () => ({ startChat: async () => null }));
vi.mock('../shell/router', () => ({ navigate: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function started() {
  let newChat: ReturnType<typeof useNewChat>;
  function Probe() {
    newChat = useNewChat('chat', true, { title: null, character: null, models: {} }, null, 'Korean');
    return null;
  }
  const root = probeRoot();
  await act(async () => root.render(<Probe />));
  expect(await newChat!.starting().saved).toBeNull();
  return root;
}

it('opens the saved chat only once its projection is made', async () => {
  const root = await started();
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => projected());
  expect(navigate).toHaveBeenCalledWith({ kind: 'chat', id: 'chat' }, { replace: true });
  act(() => root.unmount());
});

it('keeps a screen left before then, and still moves the draft to the chat', async () => {
  const root = await started();
  act(() => root.unmount());
  await act(async () => projected());
  expect(navigate).not.toHaveBeenCalled();
  expect(session.drafts.move).toHaveBeenCalledWith(expect.anything(), 'chat');
});

it('keeps the picked greeting through a change of the card beside it, and the default once the card drops it', async () => {
  let newChat: ReturnType<typeof useNewChat>;
  function Probe({ greetings }: { greetings: string[] }) {
    const shelf = { character: { card: { greetings } } } as unknown as CharacterShelf<ChatSummary>;
    newChat = useNewChat('chat', true, { title: null, character: 'character', models: {} }, shelf, 'Korean');
    return null;
  }
  const root = probeRoot();
  const opened = () => shown(newChat.unstarted!).text;
  await act(async () => root.render(<Probe greetings={['a', 'b', 'c']} />));
  act(() => newChat.pickGreeting(1));
  expect(opened()).toBe('b');
  await act(async () => root.render(<Probe greetings={['b', 'a', 'c']} />));
  expect(opened()).toBe('b');
  await act(async () => root.render(<Probe greetings={['bb', 'a', 'c']} />));
  expect(opened()).toBe('bb');
  await act(async () => root.render(<Probe greetings={['a', 'bb', 'c']} />));
  expect(opened()).toBe('bb');
  await act(async () => root.render(<Probe greetings={['a', 'c']} />));
  expect(opened()).toBe('a');
  act(() => root.unmount());
});
