import { expect, it, vi } from 'vitest';
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
