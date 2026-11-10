import { expect, it } from 'vitest';
import type { Connection } from '../../connectors/types';
import { loadMeters } from './meters';
import { stubRelay, testServer, upstream } from '../testing';

const server = testServer();

it('shows the meters one request answered when another failed, and keeps that failure', () =>
  server.withSession(async () => {
    const nanogpt: Connection = { type: 'nanogpt', label: 'NanoGPT', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'k' }], turns: null, starred: [] };
    stubRelay(({ url }) => (url.endsWith('/check-balance') ? upstream(200, { usd_balance: '12.5' }) : upstream(500, { error: 'Unable to read usage' })));
    expect(await loadMeters(nanogpt, nanogpt.accounts[0]!)).toEqual({
      meters: [{ kind: 'left', label: '잔액', unit: 'usd', amount: 12.5, limit: null, resets: null }],
      failures: [{ kind: 'provider', status: 500, detail: expect.any(String) }],
      plan: null,
    });
  }));
