import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('handles a refused audio unlock and retries it on the next gesture', async () => {
  const resume = vi.fn().mockRejectedValueOnce(new DOMException('closed', 'InvalidStateError')).mockResolvedValue(undefined);
  vi.stubGlobal('AudioContext', class { state = 'suspended'; resume = resume; });
  const { unlockSound } = await import('./sounds');
  await expect(unlockSound()).resolves.toBeNull();
  await expect(unlockSound()).resolves.toHaveProperty('resume', resume);
  expect(resume).toHaveBeenCalledTimes(2);
});

it('returns a failed preview for asset reads or decoding, and retries instead of caching a rejection', async () => {
  const buffer = {};
  const start = vi.fn();
  const decode = vi.fn().mockRejectedValueOnce(new DOMException('bad audio', 'EncodingError')).mockResolvedValue(buffer);
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    destination = {};
    decodeAudioData = decode;
    createBufferSource = () => ({ buffer: null, connect: vi.fn(), start });
  });
  const fetched = vi.fn()
    .mockRejectedValueOnce(new TypeError('Load failed'))
    .mockResolvedValueOnce(new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('Load failed')) })))
    .mockImplementation(async () => new Response(new Uint8Array([1])));
  vi.stubGlobal('fetch', fetched);
  const { playSound } = await import('./sounds');
  await expect(playSound('ding')).resolves.toBe(false);
  await expect(playSound('ding')).resolves.toBe(false);
  await expect(playSound('ding')).resolves.toBe(false);
  await expect(playSound('ding')).resolves.toBe(true);
  await expect(playSound('ding')).resolves.toBe(true);
  expect(fetched).toHaveBeenCalledTimes(4);
  expect(start).toHaveBeenCalledTimes(2);
});
