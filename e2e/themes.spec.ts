import { expect, test } from '@playwright/test';
import { assignFake, CARD, enter, fakeProvider, importFile, pickBot } from './helpers';

// The first block is the widest, so the last bubble is not.
const REPLY = 'The lantern swung once over the long stair and settled against the wall.\n\n"Mind the third step."\n\nShe went up.';

// 기본 is what every other spec runs in. Each of the others is worn from 설정 › 테마 and a turn is taken in it.
for (const name of ['클로드', '디스코드', '슬랙', '카카오톡']) {
  test(`${name}: worn from 설정, a turn and its versions, kept over a reload`, async ({ page }) => {
    await fakeProvider(() => [REPLY]);
    await assignFake(page, await enter(page), ['대화 모델']);
    await page.goto('/settings/theme');
    const card = page.getByRole('group', { name: '테마' }).getByRole('button', { name, exact: true });
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/');
    const report = await importFile(page, pickBot, CARD);
    await report.getByRole('button', { name: '새 채팅', exact: true }).click();
    await page.getByLabel('메시지', { exact: true }).fill('hi');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    const reply = page.getByRole('article').last();
    await expect(reply.getByText('She went up.')).toBeVisible();

    await reply.hover();
    await reply.getByRole('button', { name: '다시 생성', exact: true }).click();
    await expect(reply.getByText('2 / 2')).toBeVisible();
    await expect(reply.getByText('She went up.')).toBeVisible();

    if (name === '카카오톡') {
      // The time beside the last bubble, not at the widest one's edge; while the reply is written it keeps the line's end.
      const gap = async () => {
        const last = (await reply.getByText('She went up.').boundingBox())!;
        const time = (await reply.getByText(/^오[전후] \d/).boundingBox())!;
        return time.x - (last.x + last.width);
      };
      await expect.poll(gap).toBeLessThan(16);
      expect(await gap()).toBeGreaterThanOrEqual(0);
    }

    await page.reload();
    await expect(page.getByRole('article').last().getByText('She went up.')).toBeVisible();
    await page.goto('/settings/theme');
    await expect(page.getByRole('group', { name: '테마' }).getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
}

// 클로드's model menu stands in the composer's line of tools, which a folded composer hides, and a failure's 다른 모델로
// opens it by its handle.
test('클로드: the model menu a failure opens shows while the composer is folded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  let empty = false;
  const long = Array.from({ length: 14 }, (_, at) => `Step ${at + 1} of the stair.`).join('\n\n');
  await fakeProvider(() => (empty ? [] : [long]));
  await assignFake(page, await enter(page), ['대화 모델']);
  await page.goto('/settings/theme');
  await page.getByRole('group', { name: '테마' }).getByRole('button', { name: '클로드', exact: true }).click();
  await page.goto('/');
  const report = await importFile(page, pickBot, CARD);
  await report.getByRole('button', { name: '새 채팅', exact: true }).click();
  const send = async (text: string) => {
    await page.getByLabel('메시지', { exact: true }).fill(text);
    await page.getByRole('button', { name: '보내기', exact: true }).click();
  };
  await send('hi');
  await expect(page.getByText('Step 14 of the stair.')).toBeVisible();
  empty = true;
  await send('again');
  const other = page.getByRole('button', { name: '다른 모델로', exact: true });
  await expect(other).toBeVisible();

  const chip = page.getByRole('button', { name: /모델 바꾸기/ });
  await expect(chip).toBeVisible();
  await page.getByRole('article').last().hover();
  await page.mouse.wheel(0, -160);
  await expect(chip).toBeHidden();
  await other.click();
  await expect(page.getByRole('menu', { name: '모델' })).toBeVisible();
});
