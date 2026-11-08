import { expect, it } from 'vitest';
import { EMPTY_SETTINGS } from '../model/settings';
import { accountSettings, changeSettings } from './account-settings';
import { testServer } from './testing';

const server = testServer();

it('reads empty settings before their first write, and a change starts from them', async () => {
  const { store } = await server.account();
  expect(accountSettings(store)).toBe(EMPTY_SETTINGS);
  await changeSettings(store, (current) => ({ ...current, persona: 'p' }));
  expect(accountSettings(store)).toEqual({ models: {}, persona: 'p' });
});
