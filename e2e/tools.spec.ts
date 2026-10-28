import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { embedded, enter, FAKE_ADDRESS, FAKE_EMBED, FAKE_MODEL, fakeProvider, importFile, pickBot, saving, settingsPage, type FakeChatRequest } from './helpers';

const NOTE = 'The brass key is under the lantern.';
const summary = (index: number) => `TOOL_SUMMARY_${index}: the gate is open.`;
const auxiliary = (request: FakeChatRequest) => request.messages.some(({ role, content }) => role === 'system' && content.startsWith('Summarize the conversation'));
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/tools/${name}.js`, import.meta.url));

// The display-only marker observes the saved per-version state, not merely an aux response arriving at the server.
const CARD = {
  name: 'tool-observer.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({
    spec: 'chara_card_v3', spec_version: '3.0',
    data: {
      name: 'Tool observer', description: '', first_mes: 'The gate is closed.',
      extensions: { risuai: { customScripts: [{ comment: 'memory state', in: '$', out: ' [memory={{getvar::tool:hazelle/memory-lite:summary}}]', type: 'editdisplay' }] } },
    },
  })),
};

async function importPlugin(page: Page, name: string) {
  await page.goto('/plugins');
  const report = await importFile(page, '플러그인 가져오기', fixture(name));
  await report.getByRole('button', { name: '플러그인 보기', exact: true }).click();
  // Importing from 설정 › 플러그인 places the new plugin in 항상 without a second activation write.
  await expect(page.getByRole('switch', { name: '항상 켜기', exact: true })).toBeChecked();
}

async function openNotepad(page: Page) {
  await page.getByRole('button', { name: '채팅 메뉴', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /^메모장 열기/ }).click();
  const frame = page.frameLocator('iframe[title="메모장"]');
  await expect(frame.getByRole('heading', { name: '메모장', exact: true })).toBeVisible();
  return frame;
}

test('tools keep a notepad across reload and put versioned aux summaries into the tool slot', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let summaries = 0;
  const sent = await fakeProvider((request) => auxiliary(request) ? [summary(++summaries)] : ['The gate opens.']);
  const requests = () => sent as FakeChatRequest[];
  const main = () => requests().filter((request) => !auxiliary(request));
  const aux = () => requests().filter(auxiliary);

  await test.step('assign both the conversation model and an explicit auxiliary model', async () => {
    const fresh = await enter(page);
    if (fresh) {
      await page.goto('/connections/new');
      await page.getByRole('button', { name: /^직접 연결/ }).click();
      await page.getByLabel('주소', { exact: true }).fill(FAKE_ADDRESS);
      await page.getByRole('button', { name: 'OpenAI 호환', exact: true }).click();
      await page.getByRole('button', { name: '모델 선택', exact: true }).click();
      await page.getByRole('button', { name: `${FAKE_MODEL} 추가`, exact: true }).click();
      // Through the app, not page.goto: a reload would drop the model still on its way to the server.
      await settingsPage(page, '모델');
    } else await page.goto('/models');
    for (const role of ['대화 모델', '보조 모델']) {
      const picker = page.getByRole('button', { name: new RegExp(`^${role} · `) });
      if ((await picker.innerText()).includes(FAKE_MODEL)) continue;
      await picker.click();
      const saved = saving(page);
      await page.getByRole('menuitemradio', { name: new RegExp(`^${FAKE_MODEL}`) }).first().click();
      await saved;
      await expect(picker).toContainText(FAKE_MODEL);
    }
    await page.reload();
    await expect(page.getByRole('button', { name: /^보조 모델 · / })).toContainText(FAKE_MODEL);
  });

  await test.step('import the reference notepad in settings and capture its tool section', async () => {
    await importPlugin(page, 'notepad');
    await expect(page.getByRole('textbox', { name: '메모 제목', exact: true })).toHaveValue('메모장');
    await expect(page.getByRole('heading', { name: '플러그인', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('module-tool-section.png'), fullPage: true });
  });

  await test.step('write in the chat panel and reopen the persisted note after reload', async () => {
    await page.goto('/');
    const report = await importFile(page, pickBot, CARD);
    await report.getByRole('button', { name: '채팅 시작', exact: true }).click();
    // A saved chat owns the page context; the first send happens before memory is imported.
    await page.getByLabel('메시지', { exact: true }).fill('Keep this note for the journey.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText('The gate opens.');
    await expect(page.getByRole('article').last().getByRole('button', { name: '다시 생성', exact: true })).toBeAttached();
    const frame = await openNotepad(page);
    await frame.getByLabel('메모 내용', { exact: true }).fill(NOTE);
    await expect(frame.getByText('저장했어요', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('chat-tool-panel.png'), fullPage: true });
    await page.getByRole('button', { name: '메모장 닫기', exact: true }).click();
    await page.reload();
    const reopened = await openNotepad(page);
    await expect(reopened.getByLabel('메모 내용', { exact: true })).toHaveValue(NOTE);
    await page.getByRole('button', { name: '메모장 닫기', exact: true }).click();
  });

  const chat = page.url();
  await test.step('import memory and consent to it once, before its first auxiliary call', async () => {
    await importPlugin(page, 'memory');
    await expect(page.getByRole('switch', { name: '모델 호출', exact: true })).not.toBeChecked();
    await page.goto(chat);
    await page.getByLabel('메시지', { exact: true }).fill('The gate is open now.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByText('이 플러그인이 모델을 추가로 호출할 수 있어요', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '허용', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText(summary(1));
    expect(aux()).toHaveLength(1);
    expect(aux()[0]!.model).toBe(FAKE_MODEL);
  });

  await test.step('the next request carries the first summary as a tool part, shown in response info', async () => {
    await page.getByLabel('메시지', { exact: true }).fill('We walk through the gate.');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText(summary(2));
    expect(aux()).toHaveLength(2);
    expect(main().at(-1)!.messages).toContainEqual({ role: 'system', content: summary(1) });
    const last = page.getByRole('article').last();
    await last.hover();
    await last.getByRole('button', { name: '메시지 메뉴', exact: true }).click();
    await page.getByRole('menuitem', { name: '응답 정보', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '응답 정보', exact: true });
    await panel.getByRole('button', { name: '요청 원문', exact: true }).click();
    await panel.getByRole('button', { name: /^플러그인 · 간단 기억 / }).click();
    await expect(panel).toContainText(summary(1));
    await page.getByRole('button', { name: '응답 정보 닫기', exact: true }).click();
  });

  await test.step('regeneration rolls back the outgoing summary before building its request', async () => {
    const count = main().length;
    await page.getByRole('article').last().hover();
    await page.getByRole('article').last().getByRole('button', { name: '다시 생성', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText(summary(3));
    expect(main()).toHaveLength(count + 1);
    expect(aux()).toHaveLength(3);
    const regenerated = main().at(-1)!.messages;
    expect(regenerated).toContainEqual({ role: 'system', content: summary(1) });
    expect(regenerated.some(({ content }) => content.includes('TOOL_SUMMARY_2'))).toBe(false);
    expect(aux().at(-1)!.messages[0]!.content).toContain(`Previous summary: ${summary(1)}`);
  });
});

const RECALL_CARD = {
  name: 'recall-observer.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ spec: 'chara_card_v3', spec_version: '3.0', data: { name: 'Recall observer', description: '', first_mes: 'The lighthouse is dark.' } })),
};
const node = (index: number) => `RECALL_NODE_${index}: the lamp was lit.`;
const summarizing = (request: FakeChatRequest) => request.messages[0]?.content === 'RECALL_SUMMARY';

test('a memory tool holds the memory slot, recalls by embedding, badges, follows edits and branches, and never holds a send', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let nodes = 0;
  const sent = await fakeProvider((request) => summarizing(request) ? [node(++nodes)] : ['The keeper nods.']);
  // Test 1's 간단 기억 stays on in this account and summarizes after every reply.
  const main = () => (sent as FakeChatRequest[]).filter((request) => !summarizing(request) && !auxiliary(request));
  const send = async (text: string) => {
    await page.getByLabel('메시지', { exact: true }).fill(text);
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(page.getByRole('article').last()).toContainText('The keeper nods.');
    await expect(page.getByRole('article').last().getByRole('button', { name: '다시 생성', exact: true })).toBeAttached();
  };

  await test.step('pick the embedding model and import the recall tool', async () => {
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
    for (const role of ['대화 모델', '보조 모델']) {
      const picker = page.getByRole('button', { name: new RegExp(`^${role} · `) });
      if ((await picker.innerText()).includes(FAKE_MODEL)) continue;
      await picker.click();
      const saved = saving(page);
      await page.getByRole('menuitemradio', { name: new RegExp(`^${FAKE_MODEL}`) }).first().click();
      await saved;
      await expect(picker).toContainText(FAKE_MODEL);
    }
    const picker = page.getByRole('button', { name: /^임베딩 모델 · / });
    await picker.click();
    const saved = saving(page);
    await page.getByRole('menuitemradio', { name: new RegExp(`^${FAKE_EMBED}`) }).first().click();
    await saved;
    await expect(picker).toContainText(FAKE_EMBED);
    await importPlugin(page, 'recall');
    await expect(page.getByRole('switch', { name: '장기 기억 맡기기', exact: true })).not.toBeChecked();
  });

  await test.step('allow the plugin once, for its memory claim and model calls, then a chunk closes', async () => {
    await page.goto('/');
    const report = await importFile(page, pickBot, RECALL_CARD);
    await report.getByRole('button', { name: '채팅 시작', exact: true }).click();
    await send('We climb the stairs.');
    await expect(page.getByText('이 플러그인이 모델을 추가로 호출하고, 기본 장기 기억 대신 기억을 관리할 수 있어요', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '허용', exact: true }).click();
    await send('The lamp is cold.');
    await send('We light the lamp.');
    await expect.poll(() => embedded.length).toBe(1);
    expect(embedded[0]).toMatchObject({ model: FAKE_EMBED, input: [node(1)] });
    await expect(page.getByRole('article').nth(4)).toContainText('요약됨');
  });

  await test.step('the next request holds the memory in its slot, drops the covered messages and recalls after the history', async () => {
    await send('Is the lamp lit?');
    const messages = main().at(-1)!.messages;
    const memory = messages.findIndex(({ content }) => content === node(1));
    expect(memory).toBeGreaterThan(-1);
    expect(messages.some(({ content }) => content === 'We climb the stairs.')).toBe(false);
    expect(messages.some(({ content }) => content === 'We light the lamp.')).toBe(true);
    const recall = messages.findIndex(({ content }) => content.includes(`RECALL: ${node(1)}`));
    expect(recall).toBeGreaterThan(messages.findIndex(({ content }) => content === 'We light the lamp.'));
    expect(embedded.at(-1)).toMatchObject({ input: ['Is the lamp lit?'] });
    const last = page.getByRole('article').last();
    await last.hover();
    await last.getByRole('button', { name: '메시지 메뉴', exact: true }).click();
    await page.getByRole('menuitem', { name: '응답 정보', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '응답 정보', exact: true });
    await panel.getByRole('button', { name: '기억', exact: true }).click();
    await expect(panel).toContainText('회상 기억');
    await expect(panel).toContainText(node(1));
    await page.getByRole('button', { name: '응답 정보 닫기', exact: true }).click();
  });

  const chat = page.url();
  await test.step('a branch carries the memory under its own ids', async () => {
    const covered = page.getByRole('article').nth(4);
    await covered.hover();
    await covered.getByRole('button', { name: '메시지 메뉴', exact: true }).click();
    await page.getByRole('menuitem', { name: '여기서 분기', exact: true }).click();
    await expect(page).not.toHaveURL(chat);
    await send('Back on the stairs.');
    expect(main().at(-1)!.messages.some(({ content }) => content === node(1))).toBe(true);
    await page.goto(chat);
  });

  await test.step('an edit of a covered message marks its node stale, and its badge leaves with the version it replaced', async () => {
    const first = page.getByRole('article').nth(1);
    const badged = page.getByRole('article').nth(4);
    await expect(badged).toContainText('요약됨');
    await badged.hover();
    await badged.getByRole('button', { name: '수정', exact: true }).click();
    await page.getByRole('textbox', { name: '메시지 수정', exact: true }).fill('The keeper bows.');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(badged).not.toContainText('요약됨');
    await send('And now?');
    const messages = main().at(-1)!.messages;
    expect(messages.some(({ content }) => content === node(1))).toBe(false);
    expect(messages.some(({ content }) => content === 'We climb the stairs.')).toBe(true);
    await expect(first).toContainText('We climb the stairs.');
  });

  await test.step('an action waiting on its question never holds a send, which dismisses the question', async () => {
    const target = page.getByRole('article').nth(2);
    await target.hover();
    await target.getByRole('button', { name: '메시지 메뉴', exact: true }).click();
    await page.getByRole('menuitem', { name: '다시 정리', exact: true }).click();
    await expect(page.getByText('이 부분을 다시 정리할까요?', { exact: true })).toBeVisible();
    await send('Still here.');
    await expect(page.getByText('이 부분을 다시 정리할까요?', { exact: true })).toBeHidden();
  });

  await test.step('after reload the data stand and the memory panel names the tool; turned off, built-in memory is back', async () => {
    const badges = page.getByText('요약됨', { exact: true });
    const before = await badges.count();
    expect(before).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByRole('article').first()).toBeVisible();
    await expect(badges).toHaveCount(before);
    const memoryPanel = async () => {
      // The chat header slides in only while the pointer is near the top.
      await page.mouse.move(720, 10);
      await page.getByRole('button', { name: '채팅 메뉴', exact: true }).click();
      await page.getByRole('menuitem', { name: '장기 기억', exact: true }).click();
      return page.getByRole('complementary', { name: '장기 기억', exact: true });
    };
    const panel = await memoryPanel();
    await expect(panel).toContainText('회상 기억 플러그인이 장기 기억을 관리하고 있어요.');
    await page.goto('/plugins');
    await page.getByRole('button', { name: /회상 기억/ }).click();
    const saved = saving(page);
    await page.getByRole('switch', { name: '항상 켜기', exact: true }).click();
    await saved;
    await expect(page.getByRole('switch', { name: '항상 켜기', exact: true })).not.toBeChecked();
    await page.goto(chat);
    await expect(await memoryPanel()).not.toContainText('플러그인이 장기 기억을 관리하고 있어요');
  });
});
