import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { enter, importFile, pickBot } from './helpers';

const SORA = {
  name: 'sora.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Sora', creator: 'e2e-maker', creator_notes: 'A kite maker by the sea.', description: 'Sora flies kites.', first_mes: 'Hi.' } })),
};

test('a shared link opens signed out, gives its file, and a report holds it', async ({ page, browser }) => {
  let link = '';

  await test.step('share a character by link', async () => {
    await enter(page);
    await importFile(page, pickBot, SORA);
    await page.goto('/characters');
    await page.getByRole('button', { name: 'Sora 메뉴', exact: true }).first().click();
    await page.getByRole('menuitem', { name: '링크로 공유', exact: true }).click();
    const consent = page.getByLabel('내용을 읽었고 규칙을 지킬게요', { exact: true });
    await expect(consent.or(page.getByRole('button', { name: '링크 만들기', exact: true }))).toBeVisible();
    if (await consent.isVisible()) {
      await consent.check();
      await page.getByRole('button', { name: '동의하고 계속', exact: true }).click();
    }
    await page.getByRole('button', { name: '링크 만들기', exact: true }).click();
    const field = page.getByLabel('링크', { exact: true });
    await expect(field).toHaveValue(/\/s\/[\w-]{16}#[\w-]{43}$/);
    link = await field.inputValue();
  });

  const visitor = await browser.newContext();
  const guest = await visitor.newPage();
  const sent: string[] = [];
  guest.on('request', (request) => { if (request.url().includes('/api/')) sent.push(request.url()); });
  const key = link.slice(link.indexOf('#') + 1);

  await test.step('open it signed out and take its file', async () => {
    await guest.addInitScript('delete window.showSaveFilePicker');
    await guest.goto(link);
    await expect(guest.getByText('Sora', { exact: true })).toBeVisible();
    await expect(guest.getByText(/^제작자 e2e-maker · 받은 횟수 0$/)).toBeVisible();
    const saved = guest.waitForEvent('download');
    await guest.getByRole('button', { name: '파일로 받기', exact: true }).click();
    const file = await saved;
    const card = JSON.parse(new TextDecoder().decode(unzipSync(readFileSync((await file.path())!))['card.json'])) as { data: { name: string } };
    expect(card.data.name).toBe('Sora');
  });

  await test.step('bring it into a signed-in account through the same link', async () => {
    await page.goto(link);
    await page.getByRole('button', { name: '헤이젤로 가져오기', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '가져왔어요', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await guest.reload();
    // Both receipts came from this machine's one address, counted once a day.
    await expect(guest.getByText(/받은 횟수 1$/)).toBeVisible();
  });

  await test.step('report it, and the link holds', async () => {
    await guest.getByRole('button', { name: '신고', exact: true }).click();
    await guest.getByLabel('신고 내용', { exact: true }).fill('e2e report');
    await guest.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '비활성화된 링크', exact: true })).toBeVisible();
    await guest.reload();
    await expect(guest.getByRole('heading', { name: '비활성화된 링크', exact: true })).toBeVisible();
    // No request's address carries the key; only the report's body does, as its full link.
    expect(sent.filter((url) => url.includes(key))).toEqual([]);
  });

  await visitor.close();
});
