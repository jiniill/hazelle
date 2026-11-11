import { expect, test, type Page } from '@playwright/test';
import { assignFake, CARD, enter, fakeProvider, importFile, pickBot, saving, type FakeChatRequest } from './helpers';

const statusCall = (request: FakeChatRequest) => request.messages.some(({ content }) => typeof content === 'string' && content.includes('inside <status></status>'));
const RELATION = '<status>\n# 관계\n호감도: +6\n장소: 등불 여관\n</status>';
const PHONE = '<status>\n# 휴대폰\n## 메시지\n### +\n상대: 도윤\n방향: 받음\n내용: 짐은 방에 올려 뒀어요.\n### +\n상대: 도윤\n방향: 보냄\n내용: 고마워요!\n</status>';

// A card imported anew, its 상태 started from a 유형: the character's id, with a new chat of it open.
async function characterWith(page: Page, type: RegExp): Promise<string> {
  await page.goto('/');
  const report = await importFile(page, pickBot, CARD);
  await report.getByRole('button', { name: '새 채팅', exact: true }).click();
  await page.waitForURL(/\/characters\/[^/]+\/new$/);
  const id = /\/characters\/([^/]+)\/new$/.exec(page.url())![1]!;
  await page.goto(`/characters/${id}/edit?part=status`);
  const saved = saving(page);
  await page.getByRole('button', { name: type }).click();
  await saved;
  await expect(page.getByRole('heading', { name: '미리 보기' })).toBeVisible();
  await page.goto(`/characters/${id}/new`);
  return id;
}

async function send(page: Page) {
  await page.getByLabel('메시지', { exact: true }).fill('hi');
  await page.getByRole('button', { name: '보내기', exact: true }).click();
}

test('a 상태 from a 유형 is written after each reply, kept with it, and its apps stand on the 휴대폰', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let written = RELATION;
  const sent = await fakeProvider((request) => (statusCall(request) ? [written] : ['The gate opens.']));

  await test.step('assign the fake model as 대화 and 보조', async () => assignFake(page, await enter(page), ['대화 모델', '보조 모델']));

  const lab = page.getByRole('switch', { name: '상태', exact: true });
  await test.step('the feature is an experiment: switch it on', async () => {
    await page.goto('/settings/labs');
    await expect(lab).not.toBeChecked();
    const saved = saving(page);
    await lab.click();
    await saved;
  });

  await test.step('a reply moves the 상태창, and what it moved stays with the reply', async () => {
    await characterWith(page, /^연애/);
    const panel = page.getByRole('region', { name: '관계' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText('+6')).toHaveCount(0);
    await send(page);
    await expect(panel.getByText('+6')).toBeVisible();
    await expect(panel.getByText('등불 여관')).toBeVisible();
    expect((sent as FakeChatRequest[]).filter(statusCall)).toHaveLength(1);
    await page.reload();
    await expect(panel.getByText('+6')).toBeVisible();
  });

  await test.step('messages a reply brought stand in the 휴대폰, and answering one goes into the composer', async () => {
    written = PHONE;
    await characterWith(page, /^휴대폰/);
    const opener = page.getByRole('button', { name: /^휴대폰/ });
    await expect(opener).toHaveText('휴대폰');
    await send(page);
    await expect(opener).toHaveText('휴대폰 · 새 소식 1');
    await opener.click();
    const phone = page.locator('[data-side-panel]').getByRole('region', { name: '휴대폰' });
    await phone.getByRole('button', { name: /메신저/ }).click();
    await phone.getByRole('button', { name: /도윤/ }).click();
    await expect(phone.getByText('짐은 방에 올려 뒀어요.')).toBeVisible();
    await expect(phone.getByText('고마워요!')).toBeVisible();
    await phone.getByRole('button', { name: '답하기' }).click();
    await expect(page.getByLabel('메시지', { exact: true })).toHaveValue('도윤에게 메시지를 보낸다: ');
  });

  await test.step('switch it off again, since the specs after this one share the account', async () => {
    await page.goto('/settings/labs');
    const saved = saving(page);
    await lab.click();
    await saved;
  });
});
