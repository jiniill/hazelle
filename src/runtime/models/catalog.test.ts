import { expect, it } from 'vitest';
import { bareModel } from '../../connectors/chat-completions';
import type { Connection } from '../../connectors/types';
import { catalogKey } from './catalog';

it('keys catalogs by provider, endpoint, protocol and credential, not presentation or stars', () => {
  const connection: Connection = { type: 'generic', label: '직접 연결', baseUrl: 'https://example.com/v1', protocol: 'chat-completions', accounts: [{ id: 'key', secret: 'key' }], turns: null, starred: [] };
  const key = catalogKey(connection);
  expect(catalogKey({ ...connection, label: '이름 변경', starred: [bareModel('m')] })).toBe(key);
  expect(catalogKey({ ...connection, type: 'openrouter' })).not.toBe(key);
  expect(catalogKey({ ...connection, baseUrl: 'https://other.example.com/v1' })).not.toBe(key);
  expect(catalogKey({ ...connection, protocol: 'anthropic-messages' })).not.toBe(key);
  expect(catalogKey({ ...connection, accounts: [{ id: 'key', secret: 'other-key' }] })).not.toBe(key);
});
