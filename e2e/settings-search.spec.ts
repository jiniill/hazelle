import { expect, test } from '@playwright/test';
import { enter } from './helpers';

test('a 설정 검색 hit opens the fold around its row and brings the row into view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 480 });
  if (!(await enter(page))) await page.goto('/');
  await page.goto('/settings/display');
  await page.getByRole('searchbox', { name: '설정 검색' }).fill('내 메시지에서도 멈추기');
  await page.getByRole('navigation', { name: '설정' }).getByRole('button', { name: /^내 메시지에서도 멈추기/ }).click();
  await expect(page.getByRole('heading', { name: '조작', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '세부 설정', expanded: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: '내 메시지에서도 멈추기' })).toBeInViewport();
});
