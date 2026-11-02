import { expect, it } from 'vitest';
import { accountSettings } from './account-settings';
import { testServer } from './testing';

const server = testServer();

it('reads no settings before their first write, then the written value', async () => {
  const { store } = await server.account();
  expect(accountSettings(store)).toBeUndefined();
  await store.upsert('settings', () => ({ models: {}, persona: 'p' }));
  expect(accountSettings(store)).toEqual({ models: {}, persona: 'p' });
});
