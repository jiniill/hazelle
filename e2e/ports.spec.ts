import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { embedded, enter, FAKE_ADDRESS, FAKE_EMBED, FAKE_MODEL, fakeProvider, importFile, pickBot, saving, settingsPage, type FakeChatRequest } from './helpers';

// Ports of public plugins live in the private docs repo (their licenses are unknown), so this file runs only beside it.
const HYPAPLUS = fileURLToPath(new URL('../docs/research/ports/hypaplus/hypaplus.js', import.meta.url));
const REPLY = 'The keeper nods.';
// Chunk n's summary: an event and an older fact, so the newest-node memory and the recall after the history differ.
const EVENT = (n: number) => `HYPA_EVENT_${n} the lamp was lit at the top.`;
const FACT = (n: number) => `HYPA_FACT_${n} the key hides under the lamp.`;
const summary = (n: number) => `<event>\n시간: 2024-05-01 10:00\n장소: 등대\n인물: 미라\n내용: ${EVENT(n)}\n</event>\n<facts>\n인물: 미라\n시간: 2024-05-01 09:00\n내용: ${FACT(n)}\n</facts>`;
// HypaPlus's own summary prompt carries this heading above the log it summarizes.
const summarizing = (request: FakeChatRequest) => request.messages.some(({ content }) => content.includes('# Roleplay Log'));
const CARD = {
  name: 'lighthouse.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Lighthouse', description: '', first_mes: 'The lighthouse is dark.' } })),
};

test('the HypaPlus port summarizes chunks, holds the memory slot, recalls after the history and keeps its nodes', async ({ page }) => {
  test.skip(!existsSync(HYPAPLUS), 'the HypaPlus port lives in the private docs repo');
  await page.setViewportSize({ width: 1440, height: 900 });
  let chunks = 0;
  const sent = await fakeProvider((request) => summarizing(request) ? [summary(++chunks)] : [REPLY]);
  const summaries = () => (sent as FakeChatRequest[]).filter(summarizing);
  const main = () => (sent as FakeChatRequest[]).filter((request) => !summarizing(request));
  const send = async (text: string) => {
    await page.getByLabel('메시지', { exact: true }).fill(text);
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText(REPLY);
    await expect(page.getByRole('article').last().getByRole('button', { name: '다시 생성', exact: true })).toBeAttached();
  };

  await test.step('connect the fake provider and pick its embedding model', async () => {
    await enter(page);
    await page.goto('/connections/new');
    await page.getByRole('button', { name: /^직접 연결/ }).click();
    await page.getByLabel('주소', { exact: true }).fill(FAKE_ADDRESS);
    await page.getByRole('button', { name: 'OpenAI 호환', exact: true }).click();
    await page.getByRole('button', { name: '모델 선택', exact: true }).click();
    await page.getByRole('button', { name: `${FAKE_MODEL} 추가`, exact: true }).click();
    await page.getByRole('button', { name: `${FAKE_EMBED} 추가`, exact: true }).click();
    // Through the app, not page.goto: a reload would drop the models still on their way to the server.
    await settingsPage(page, '모델');
    for (const [role, model] of [['대화 모델', FAKE_MODEL], ['보조 모델', FAKE_MODEL], ['임베딩 모델', FAKE_EMBED]] as const) {
      const picker = page.getByRole('button', { name: new RegExp(`^${role} · `) });
      if ((await picker.innerText()).includes(model)) continue;
      await picker.click();
      const saved = saving(page);
      await page.getByRole('menuitemradio', { name: new RegExp(`^${model}`) }).first().click();
      await saved;
      await expect(picker).toContainText(model);
    }
  });

  await test.step('import the port as a module and make its chunks small', async () => {
    await page.goto('/plugins');
    const report = await importFile(page, '플러그인 가져오기', HYPAPLUS);
    await report.getByRole('button', { name: '플러그인 보기', exact: true }).click();
    await expect(page.getByRole('switch', { name: '항상 켜기', exact: true })).toBeChecked();
    await expect(page.getByRole('switch', { name: '장기 기억 맡기기', exact: true })).not.toBeChecked();
    const settings = [['청크 크기', '2'], ['자동 요약 기준', '3'], ['최근 노드 수', '1']] as const;
    for (const [label, value] of settings) {
      const saved = saving(page);
      await page.getByRole('textbox', { name: label, exact: true }).fill(value);
      await saved;
    }
    await page.reload();
    for (const [label, value] of settings) await expect(page.getByRole('textbox', { name: label, exact: true })).toHaveValue(value);
  });

  await test.step('allow the plugin once, for its memory claim and model calls, then a chunk closes', async () => {
    await page.goto('/');
    const report = await importFile(page, pickBot, CARD);
    await report.getByRole('button', { name: '채팅 시작', exact: true }).click();
    await send('We climb the stairs.');
    await expect(page.getByText('이 플러그인이 모델을 추가로 호출하고, 기본 장기 기억 대신 기억을 관리할 수 있어요', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '허용', exact: true }).click();
    await send('The lamp is cold.');
    await expect.poll(() => embedded.length).toBe(1);
    expect(summaries()).toHaveLength(1);
    const log = summaries()[0]!.messages.map(({ content }) => content).join('\n');
    expect(log).toContain('The lighthouse is dark.');
    expect(log).toContain('We climb the stairs.');
    expect(log).not.toContain('The lamp is cold.');
    expect(embedded[0]!.model).toBe(FAKE_EMBED);
    expect(embedded[0]!.input).toHaveLength(2);
    expect(embedded[0]!.input[0]).toContain(EVENT(1));
    await expect(page.getByRole('article').nth(2)).toContainText('요약 #1');
  });

  await test.step('the next request holds the newest node in the memory slot, drops the covered messages and recalls after the history', async () => {
    await send('Is the lamp lit?');
    expect(embedded.some(({ input }) => input.length === 1 && input[0]!.endsWith('Is the lamp lit?'))).toBe(true);
    const messages = main().at(-1)!.messages;
    const memory = messages.findIndex(({ content }) => content.includes(EVENT(1)));
    const kept = messages.findIndex(({ content }) => content === 'The lamp is cold.');
    const recall = messages.findIndex(({ content }) => content.includes(FACT(1)));
    expect(memory).toBeGreaterThan(-1);
    expect(messages[memory]!.content).not.toContain(FACT(1));
    expect(messages.some(({ content }) => content === 'We climb the stairs.')).toBe(false);
    expect(kept).toBeGreaterThan(memory);
    expect(recall).toBeGreaterThan(kept);
  });

  await test.step('after reload the nodes stand: the badge, the next request and the port page', async () => {
    await page.reload();
    await expect(page.getByRole('article').nth(2)).toContainText('요약 #1');
    await send('Where is the key?');
    const messages = main().at(-1)!.messages;
    expect(messages.some(({ content }) => content.includes('HYPA_EVENT_'))).toBe(true);
    expect(messages.some(({ content }) => content === 'We climb the stairs.')).toBe(false);
    // The chat header slides in only while the pointer is near the top.
    await page.mouse.move(720, 10);
    await page.getByRole('button', { name: '채팅 메뉴', exact: true }).click();
    await page.getByRole('menuitemradio', { name: /^HypaPlus 열기/ }).click();
    const frame = page.frameLocator('iframe[title="HypaPlus"]');
    await expect(frame.getByText(EVENT(1), { exact: true })).toBeVisible();
    await expect(frame.getByText(FACT(1), { exact: true })).toBeVisible();
    await frame.getByRole('button', { name: '청크', exact: true }).click();
    await expect(frame.getByRole('heading', { name: '청크 #1', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'HypaPlus 닫기', exact: true }).click();
  });

  await test.step('turn the port off so later specs in this account keep the built-in memory', async () => {
    await page.goto('/plugins');
    await page.getByRole('button', { name: /HypaPlus/ }).click();
    const saved = saving(page);
    await page.getByRole('switch', { name: '항상 켜기', exact: true }).click();
    await saved;
    await expect(page.getByRole('switch', { name: '항상 켜기', exact: true })).not.toBeChecked();
  });
});
