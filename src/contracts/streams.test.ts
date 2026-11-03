import { expect, it } from 'vitest';
import { askedWait, retryWait } from './streams';

it("reads a Google API's RetryInfo when no Retry-After is sent", () => {
  const info = (retryDelay: string) => ({ error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure' }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] } });
  expect(askedWait(null, info('37.2s'))).toBe('38');
  expect(askedWait(null, [info('5s')])).toBe('5');
  expect(askedWait('3', info('37s'))).toBe('3');
  expect(askedWait(null, { error: { message: 'busy' } })).toBeNull();
});

it('waits longer after each try, or as long as the provider asks, and not at all past a minute', () => {
  expect([1, 2, 3].map((tries) => retryWait(tries, null, 0))).toEqual([2000, 4000, 8000]);
  expect(retryWait(1, '7', 0)).toBe(7000);
  expect(retryWait(1, new Date(30_000).toUTCString(), 0)).toBe(30_000);
  expect(retryWait(1, '0', 0)).toBe(0);
  expect(retryWait(1, '120', 0)).toBeNull();
  expect(retryWait(2, 'soon', 0)).toBe(4000);
});
