import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setUp, signUpAsGuest, startServer, stopServer } from './helpers';

// An installation whose operator admits more accounts, as hazelle.app does: a server of its own, since the suite's keeps
// the cap of one, which makes it one person's and shows no guest.
const PORT = 4421;
let server: ChildProcess;

test.use({ baseURL: `http://localhost:${PORT}` });
test.beforeAll(async () => {
  server = await startServer(PORT, join(tmpdir(), 'hazelle-signup-spec'), true);
});
test.afterAll(() => stopServer(server));

test('once the operator admits more accounts, a visitor opens as a guest and signs up with a username', async ({ page, browser }) => {
  await page.goto('/');
  await setUp(page, 'operator-password');
  await expect(page.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();
  const { session } = await (await page.request.get('/api/session')).json();
  expect((await page.request.put('/api/admin/service', {
    headers: { 'x-account': session.accountId }, data: { signupCap: 2, accountBytesCap: null, accountFileBytesCap: null },
  })).status()).toBe(204);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/');
  await expect(visitor.getByRole('region', { name: '손님 모드', exact: true })).toBeVisible();
  await signUpAsGuest(visitor, 'friend', 'friend-password');
  await expect(visitor.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();
  await expect(visitor.getByRole('region', { name: '손님 모드', exact: true })).toHaveCount(0);
  await visitor.context().close();
});
