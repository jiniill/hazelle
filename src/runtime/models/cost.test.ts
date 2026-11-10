import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Connection } from '../../connectors/types';
import { settleCost } from './cost';
import { inTurn, stubRelay, upstream } from '../testing';

const connection: Connection = { type: 'vercel', label: 'Vercel', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'vck_x' }], turns: null, starred: [] };

const vercel = (answers: [number, unknown][]) => stubRelay(inTurn(answers.map(([status, body]) => upstream(status, body))));

async function settle() {
  const result = settleCost(connection, 'gen_01K', new AbortController().signal);
  await vi.runAllTimersAsync();
  return result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('settling a cost', () => {
  const notYet: [number, unknown] = [404, { error: { message: 'No usage event found with ID' } }];

  it('asks again while the cost is not booked, then reads it', async () => {
    const log = vercel([notYet, notYet, [200, { data: { total_cost: 0.00123 } }]]);
    expect(await settle()).toEqual({ ok: true, cost: { unit: 'usd', amount: 0.00123, source: 'reported' } });
    expect(log.map((call) => call.at)).toEqual([0, 1, 3]);
  });

  it('gives up after about a minute, and at once on any other refusal', async () => {
    const log = vercel(Array.from({ length: 7 }, () => notYet));
    expect(await settle()).toMatchObject({ ok: false, failure: { kind: 'provider', status: 404 } });
    expect(log.at(-1)!.at).toBe(60);
    vercel([[401, { error: { message: 'Authentication failed.' } }]]);
    expect(await settle()).toMatchObject({ ok: false, failure: { kind: 'provider', status: 401 } });
  });
});
