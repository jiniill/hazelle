import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { cachedDatabase } from './database';

it('reopens through the cached open path after an unexpected close', async () => {
  const open = cachedDatabase(crypto.randomUUID(), 1, (request) => request.result.createObjectStore('values'));
  const first = await open();
  expect(await open()).toBe(first);
  const closed = new Promise<void>((resolve) => first.addEventListener('close', () => resolve(), { once: true }));
  forceCloseDatabase(first as unknown as Parameters<typeof forceCloseDatabase>[0]);
  await closed;
  const next = await open();
  try {
    expect(next).not.toBe(first);
    expect(next.transaction('values').objectStore('values').name).toBe('values');
    expect(await open()).toBe(next);
  } finally { next.close(); }
});
