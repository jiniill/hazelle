import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_TYPES, RETRIES } from '../connectors/registry';
import { bareModel } from '../connectors/chat-completions';
import type { Connection, Model } from '../connectors/types';
import type { HttpRequest } from '../contracts/http';
import { cycleOf } from '../model/turns';
import { streamKey } from '../vault/streams';
import { Credentials } from './credential';
import { gather, generate } from './generate';
import { Pool } from './pool';
import { LOGGED, stubRelay, testLog, testServer, upstream } from './testing';

const server = testServer();
beforeEach(() => server.account());
afterEach(() => vi.useRealTimers());

const USER = 'https://api.github.com/copilot_internal/user';
const EXCHANGE = 'https://api.github.com/copilot_internal/v2/token';
const OCTOBER_10 = new Date(2026, 9, 10, 12).getTime();
const OCTOBER_20 = new Date(2026, 9, 20, 12).getTime();

const left = (remaining: number) => ({ quota_snapshots: { premium_interactions: { entitlement: 300, remaining } }, quota_reset_date_utc: '2026-11-01T00:00:00Z' });
// By the account's secret: what its allowance answers, or a status it fails with.
const allowances = (answers: Record<string, object | number>) =>
  stubRelay(({ url, headers }: HttpRequest) => {
    if (url === EXCHANGE) return upstream(200, { token: `tid:${headers.authorization}`, expires_at: Math.floor(Date.now() / 1000) + 1800 });
    if (url !== USER) return new Response('{"message":"down"}', { status: 500, headers: { 'x-relay': 'upstream', 'retry-after': '0' } });
    const answer = answers[headers.authorization!.replace('Bearer ', '')]!;
    return typeof answer === 'number' ? upstream(answer, { message: 'no' }) : upstream(200, answer);
  });

// Group 1 (a, b) has the turn that started on 16 September; group 2 (c) takes it on 16 October.
const pool = (two: string[] = ['c']): Connection => ({
  type: 'copilot',
  label: 'Copilot',
  baseUrl: null,
  protocol: null,
  accounts: ['a', 'b', 'c'].map((id) => ({ id, secret: id, name: `user-${id}` })),
  turns: { day: 16, groups: [{ id: 'g1', name: '그룹 1', accounts: ['a', 'b'] }, { id: 'g2', name: '그룹 2', accounts: two }], anchor: { group: 'g1', cycle: cycleOf(OCTOBER_10, 16) } },
  starred: [],
});

const at = (now: number) => vi.useFakeTimers({ toFake: ['Date'], now });

describe('Pool.pick', () => {
  it('tells its subscribers when a read settles, so a screen shows what peek and held now say', async () => {
    allowances({ a: left(5) });
    at(OCTOBER_10);
    const reading = new Pool();
    const heard = vi.fn();
    reading.subscribe(heard);
    const connection = pool();
    await reading.meters(connection, connection.accounts[0]!);
    expect(heard).toHaveBeenCalledOnce();
    expect(reading.held(connection, connection.accounts[0]!)).not.toBeNull();
  });

  it('serves the group whose turn it is by the switch day, and in it the first account with allowance left', async () => {
    allowances({ a: left(0), b: left(5), c: { quota_snapshots: { premium_interactions: { unlimited: true } } } });
    at(OCTOBER_10);
    expect(await new Pool().pick(pool())).toMatchObject({ ok: true, account: { id: 'b' } });
    at(OCTOBER_20);
    expect(await new Pool().pick(pool())).toMatchObject({ ok: true, account: { id: 'c' } });
  });

  it('refuses only a group with no account; with no allowance left it leaves the provider to decide', async () => {
    allowances({ a: left(0), b: 500 });
    at(OCTOBER_20);
    expect(await new Pool().pick(pool([]))).toEqual({ ok: false, failure: { kind: 'pool', group: '그룹 2' } });
    at(OCTOBER_10);
    expect(await new Pool().pick(pool())).toMatchObject({ ok: true, account: { id: 'b' } });
    allowances({ a: left(0), b: left(0) });
    expect(await new Pool().pick(pool())).toMatchObject({ ok: true, account: { id: 'a' } });
  });
});

it('reads a failed reply’s account again before the next pick, and sends that reply again only on its own account', async () => {
  const log = allowances({ a: left(5), b: left(5) });
  at(OCTOBER_10);
  const credentials = new Credentials();
  const model: Model = { ...bareModel('gpt-4.1'), name: 'gpt' };
  const send = async () => {
    const key = await streamKey();
    return generate({ credentials, log: testLog(), connection: pool(), model, settings: {}, retries: RETRIES, messages: [{ role: 'user', content: '안녕' }], call: { id: crypto.randomUUID(), key: key.private, public: key.public, logged: LOGGED }, signal: new AbortController().signal, onText: gather() });
  };
  expect(await send()).toMatchObject({ state: 'failed', account: 'a' });
  expect(await send()).toMatchObject({ state: 'failed', account: 'a' });
  const urls = log.map(({ sent }) => sent.url);
  expect(urls.filter((url) => url === USER)).toHaveLength(3);
  const tries = log.filter(({ sent }) => sent.url.endsWith('/chat/completions'));
  expect(tries).toHaveLength(6);
  expect(new Set(tries.map(({ sent }) => sent.headers.authorization))).toEqual(new Set([tries[0]!.sent.headers.authorization]));
});

it('has no pool type that books a cost after the reply, which settles on the connection’s one account', () => {
  expect(CONNECTION_TYPES.filter((type) => type.pool && type.settle)).toEqual([]);
});
