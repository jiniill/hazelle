import { expect, it, vi } from 'vitest';
import { AccountFacts, deleteAccount, loadSession } from './account';
import { setService } from '../service/admin';
import { api, holdAccount } from '../api';
import { testServer } from '../testing';

const server = testServer();

it('deletes the account only with its password proof, after which the session is gone and its seat open again', async () => {
  // The first signup is the operator, whom nothing deletes; the account under test is the second.
  await server.operator();
  expect(await setService({ signupCap: 2, accountBytesCap: null, accountFileBytesCap: null })).toMatchObject({ ok: true });
  await server.account('other');
  expect(await deleteAccount({ method: 'recovery', proof: server.passwordProof.proof })).toEqual({ ok: false, error: 'wrong-login' });
  expect(await deleteAccount(server.passwordProof)).toEqual({ ok: true, data: undefined });
  expect(await loadSession()).toEqual({ ok: true, data: { session: null, door: { kind: 'open' } } });
});

it('holds a restore under way from the session or a 503, until the store answers with its bytes', async () => {
  const facts = new AccountFacts({ suspended: false, state: 'restoring', storage: { bytes: null, bytesCap: null, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0 });
  expect(facts.snapshot().restoring).toBe(true);
  facts.heard({ kind: 'bytes', bytes: 10 });
  expect(facts.snapshot()).toMatchObject({ restoring: false, storage: { bytes: 10 } });
  holdAccount('a', (heard) => heard.kind !== 'elsewhere' && facts.heard(heard));
  vi.stubGlobal('fetch', async () => Response.json({ error: 'account-restoring', retryAfter: 5 }, { status: 503 }));
  expect(await api('GET', 'objects?since=0')).toEqual({ ok: false, error: 'account-restoring', retryAfter: 5 });
  expect(facts.snapshot().restoring).toBe(true);
  vi.unstubAllGlobals();
});

it('learns a suspension and a full account from refusals, and holds full until the account shrinks', () => {
  const facts = new AccountFacts({ suspended: false, state: 'active', storage: { bytes: 100, bytesCap: 100, fileBytes: 0, fileBytesCap: null }, unreadNotices: 0, unreadBoard: 0 });
  facts.heard({ kind: 'storage-full' });
  facts.heard({ kind: 'bytes', bytes: 120 });
  expect(facts.snapshot()).toMatchObject({ suspended: false, full: true, storage: { bytes: 120 } });
  facts.heard({ kind: 'bytes', bytes: 90 });
  facts.heard({ kind: 'suspended' });
  expect(facts.snapshot()).toMatchObject({ suspended: true, full: false, storage: { bytes: 90 } });
});
