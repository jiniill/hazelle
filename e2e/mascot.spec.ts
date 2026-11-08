import { expect, test } from '@playwright/test';
import { CARD, enter, FAKE_ADDRESS, FAKE_MODEL, fakeProvider, importFile, pickBot, saving, settingsPage, type FakeChatRequest } from './helpers';

const LINE = '드디어 시작인 것이와요!';
const mascotCall = (request: FakeChatRequest) => request.messages.some(({ role, content }) => role === 'system' && content.startsWith('You are a mascot'));

test('the mascot, switched on, leaves a line on the reply that survives a reload', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sent = await fakeProvider((request) => (mascotCall(request) ? [JSON.stringify({ expression: 'thrilled', line: LINE })] : ['The gate opens.']));

  await test.step('assign the fake model as 대화 and 보조', async () => {
    if (await enter(page)) {
      await page.goto('/connections/new');
      await page.getByRole('button', { name: /^직접 연결/ }).click();
      await page.getByLabel('주소', { exact: true }).fill(FAKE_ADDRESS);
      await page.getByRole('button', { name: 'OpenAI 호환', exact: true }).click();
      await page.getByRole('button', { name: '모델 선택', exact: true }).click();
      await page.getByRole('button', { name: `${FAKE_MODEL} 추가`, exact: true }).click();
      await settingsPage(page, '모델');
    } else await page.goto('/models');
    for (const role of ['대화 모델', '보조 모델']) {
      const picker = page.getByRole('button', { name: new RegExp(`^${role} · `) });
      if ((await picker.innerText()).includes(FAKE_MODEL)) continue;
      await picker.click();
      const saved = saving(page);
      await page.getByRole('menuitemradio', { name: new RegExp(`^${FAKE_MODEL}`) }).first().click();
      await saved;
    }
  });

  await test.step('the mascot starts off; switch it on for every chat', async () => {
    await page.goto('/settings/chat/mascot');
    const on = page.getByRole('switch', { name: '채팅에서 쓰기' });
    await expect(on).not.toBeChecked();
    const saved = saving(page);
    await on.click();
    await saved;
    await expect(on).toBeChecked();
  });

  const mark = page.getByRole('button', { name: '영애의 한마디', exact: true });
  await test.step('a reply gets the mark, and pointing at it shows the line and the face', async () => {
    await page.goto('/');
    const report = await importFile(page, pickBot, CARD);
    await report.getByRole('button', { name: '새 채팅', exact: true }).click();
    await page.getByLabel('메시지', { exact: true }).fill('hi');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(mark).toBeVisible();
    expect((sent as FakeChatRequest[]).filter(mascotCall)).toHaveLength(1);
    await page.screenshot({ path: info.outputPath('mascot-closed.png') });
    await mark.hover();
    const card = page.getByRole('note');
    await expect(card).toContainText(LINE);
    await expect.poll(() => card.locator('img').evaluate((img) => (img as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath('mascot-open.png') });
  });

  await test.step('the line is stored with its reply', async () => {
    await page.reload();
    await expect(mark).toBeVisible();
    await mark.hover();
    await expect(page.getByRole('note')).toContainText(LINE);
  });

  await test.step('switch it off again, since the specs after this one share the account', async () => {
    await page.goto('/settings/chat/mascot');
    const saved = saving(page);
    await page.getByRole('switch', { name: '채팅에서 쓰기' }).click();
    await saved;
  });
});
