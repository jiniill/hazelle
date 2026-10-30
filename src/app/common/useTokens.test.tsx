import { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { probeRoot } from '../ui/probe';
import { useTokens } from './useTokens';

const count = vi.fn(async (texts: string[]) => texts.map((text) => text.length));
const session = { store: { evaluation: { count } } };
vi.mock('../session', () => ({ useSession: () => session }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  count.mockClear();
});

it('counts a text once until it changes, at most once a second', async () => {
  let tokens: ReturnType<typeof useTokens> = null;
  const Field = ({ text }: { text: string }) => {
    tokens = useTokens([text]);
    return null;
  };
  const root = probeRoot();
  await act(async () => root.render(<Field text="abc" />));
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(tokens).toBe(3);
  expect(count).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Field text="abcde" />));
  await act(async () => root.render(<Field text="abcdefg" />));
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(tokens).toBe(7);
  expect(count).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});
