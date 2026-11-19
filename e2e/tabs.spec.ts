import { expect, test } from '@playwright/test';
import { assignFake, CARD, enter, fakeProvider, importFile, pickBot } from './helpers';

test('a middle click on a chat in the list opens it in a new tab and leaves this one where it is', async ({ page, context }) => {
  await fakeProvider();
  await assignFake(page, await enter(page), ['대화 모델']);
  await page.goto('/');
  const report = await importFile(page, pickBot, CARD);
  await report.getByRole('button', { name: '새 채팅', exact: true }).click();
  await page.getByLabel('메시지', { exact: true }).fill('hi');
  await page.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(3);
  await expect(page).toHaveURL(/\/chats\//);

  const here = page.url();
  const row = page.getByRole('complementary', { name: '캐릭터 목록' }).locator('a[aria-current]');
  const chat = await row.getAttribute('href');
  expect(chat).toMatch(/^\/chats\//);
  const opened = context.waitForEvent('page');
  await row.click({ button: 'middle' });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe(chat);
  await expect(tab.getByRole('article').first()).toBeVisible();
  expect(page.url()).toBe(here);
});
