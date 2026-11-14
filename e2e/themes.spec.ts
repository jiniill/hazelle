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
