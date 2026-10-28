import { expect, it, vi } from 'vitest';
import type { ApiFailure } from './api';
import { ConnectionWait } from './connection-wait';

it('jitters each wait without retrying before the server retryAfter', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValueOnce(0.2).mockReturnValueOnce(0.8);
  const attempt = vi.fn().mockResolvedValueOnce({ ok: false, error: 'offline' })
    .mockResolvedValueOnce({ ok: false, error: 'busy', retryAfter: 2 })
    .mockResolvedValue({ ok: true, data: null });
  const wait = new ConnectionWait();
  try {
    const result = wait.run(attempt, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    expect(attempt).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(attempt).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(800);
    expect(await result).toEqual({ ok: true, data: null });
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(wait.waiting()).toBe(false);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

it('passes stop to an in-flight retry so abort ends the attempt and the wait', async () => {
  vi.useFakeTimers();
  const stop = new AbortController();
  const wait = new ConnectionWait();
  const attempt = vi.fn<(signal: AbortSignal) => Promise<ApiFailure>>()
    .mockResolvedValueOnce({ ok: false, error: 'offline' })
    .mockImplementation((signal) => new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve({ ok: false, error: 'stopped' }), { once: true });
    }));
  try {
    const running = wait.run(attempt, stop.signal);
    await vi.advanceTimersByTimeAsync(1500);
    expect(attempt).toHaveBeenLastCalledWith(stop.signal);
    expect(wait.waiting()).toBe(true);
    stop.abort();
    expect(await running).toEqual({ ok: false, error: 'stopped' });
    expect(wait.waiting()).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
