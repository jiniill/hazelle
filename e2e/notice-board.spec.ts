import { expect, test } from '@playwright/test';
import { enter } from './helpers';

// The 게시판 (design §6.13). The e2e account is the installation's first, the operator, who writes as 운영자 and is asked
// for no nickname; the nickname gate is the server's rule for every other account (server/board.test).
test('the operator posts, comments, votes, and finds it all after a reload', async ({ page }) => {
  await enter(page);
  await page.getByRole('button', { name: '게시판', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: '게시판', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '글쓰기', exact: true }).click();

  await test.step('write a public post', async () => {
    await page.getByLabel('제목', { exact: true }).fill('첫 글');
    await page.getByRole('group', { name: '분류', exact: true }).getByRole('button', { name: '제안', exact: true }).click();
    await page.getByLabel('내용', { exact: true }).fill('게시판이 열렸어요. https://hazelle.app');
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '첫 글', exact: true })).toBeVisible();
    await expect(page.getByText(/^운영자/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'https://hazelle.app', exact: true })).toBeVisible();
  });

  await test.step('comment and vote', async () => {
    await page.getByLabel('댓글', { exact: true }).fill('첫 댓글');
    await page.getByRole('button', { name: '등록', exact: true }).click();
    await expect(page.getByText('첫 댓글', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '추천 0', exact: true }).click();
    await expect(page.getByRole('button', { name: /^추천 1/ })).toBeVisible();
  });

  await test.step('the list and the post read back after a reload', async () => {
    await page.reload();
    await expect(page.getByRole('heading', { name: '첫 글', exact: true })).toBeVisible();
    await expect(page.getByText('첫 댓글', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^추천 1/ })).toBeVisible();
    await page.getByRole('button', { name: '게시판', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /첫 글/ })).toBeVisible();
  });

  await test.step('an operator-only post carries a picture, shown large and removable', async () => {
    await page.getByRole('button', { name: '글쓰기', exact: true }).click();
    await page.getByLabel('제목', { exact: true }).fill('경고가 떠요');
    await page.getByRole('group', { name: '분류', exact: true }).getByRole('button', { name: '버그', exact: true }).click();
    await page.getByRole('group', { name: '공개 범위', exact: true }).getByRole('button', { name: /운영자에게만/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '사진 추가', exact: true }).click();
    await (await chooser).setFiles({ name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64') });
    await expect(page.getByRole('img', { name: '사진 1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '올리기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '경고가 떠요', exact: true })).toBeVisible();

    const picture = page.getByRole('img', { name: '사진 1', exact: true });
    await expect.poll(() => picture.evaluate((image) => (image as unknown as { naturalWidth: number }).naturalWidth)).toBe(1);
    await page.getByRole('button', { name: '사진 1 크게 보기', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '사진 1', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await page.reload();
    await page.getByRole('button', { name: '사진 1 빼기', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(page.getByRole('img', { name: '사진 1', exact: true })).toHaveCount(0);
  });
});
