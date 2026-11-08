import { expect, test } from '@playwright/test';

test('session loading and retry stay visible without downloading a screen', async ({ page }) => {
  let respond = () => {};
  let attempts = 0;
  const scripts: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/api/session', async (route) => {
    const attempt = ++attempts;
    await new Promise<void>((resolve) => { respond = resolve; });
    await route.fulfill({ status: attempt === 1 ? 500 : 200, json: attempt === 1 ? { error: 'server-error' } : { session: null, door: { kind: 'full' } } });
  });

  // A browser that opened an account before, whose session lapsed: it asks for that login rather than opening a guest.
  await page.addInitScript(() => localStorage.setItem('risu-alpha:entry', 'e2e'));
  await page.goto('/');
  const progress = page.getByRole('progressbar', { name: '계정 확인', exact: true });
  await expect(progress).toBeVisible();
  await expect.poll(() => attempts).toBe(1);
  respond();
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(progress).toBeVisible();
  await expect.poll(() => attempts).toBe(2);
  respond();
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible();
  await expect(page.getByLabel('아이디', { exact: true })).toHaveValue('e2e');
  await expect(progress).toHaveCount(0);
  // A returning browser fetches the workspace while the server answers (main.tsx); a screen waits for its place.
  expect(scripts.some((url) => /\/(AdminScreen|ChatScreen|PromptScreen)-/.test(url))).toBe(false);
  expect(errors).toEqual([]);
});
