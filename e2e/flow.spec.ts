import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import featherlessModels from '../src/connectors/fixtures/featherless-models.json' with { type: 'json' };
import { featherless } from '../src/connectors/featherless';
import { pageCsp } from '../src/server/static';
import { CARD, confirmImport, DESCRIPTION, FAKE_ADDRESS, FAKE_MODEL, fakeProvider, HOSTILE, MODULE, pickBot, SCRIPTED, settingsPage, setUp } from './helpers';

const PASSWORD = 'e2e-password';
const NICKNAME = 'rich-steve';
const COPY = `${FAKE_MODEL} low`;
const GREETING = /Welcome to the inn\. Tonight's omen is (amber|birch)\./;

test('a new account imports a card, chats through the fake provider and finds the chat after a reload', async ({ page }) => {
  const sent = await fakeProvider();
  const evaluations: number[] = [];
  page.on('response', (response) => { if (/evaluation-worker-[\w-]+\.js$/.test(response.url())) evaluations.push(response.status()); });
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  const messages = page.getByRole('article');

  await test.step('set the password and reach the library', async () => {
    const response = await page.goto('/');
    const policy = response?.headers()['content-security-policy'] ?? '';
    expect(policy).toBe(pageCsp(/'nonce-([^']+)'/.exec(policy)?.[1] ?? ''));
    await setUp(page, PASSWORD);
    await expect(page.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: '손님 모드', exact: true })).toHaveCount(0);
  });

  await test.step('connect the fake provider and make its model the default', async () => {
    await page.getByRole('button', { name: /^새 연결/ }).click();
    await page.getByRole('button', { name: /^직접 연결/ }).click();
    await page.getByLabel('주소', { exact: true }).fill(FAKE_ADDRESS);
    await page.getByRole('button', { name: 'OpenAI 호환', exact: true }).click();
    await page.getByRole('button', { name: '모델 선택', exact: true }).click();
    await page.getByRole('button', { name: `${FAKE_MODEL} 추가`, exact: true }).click();
    await settingsPage(page, '모델');
    const main = page.getByRole('button', { name: /^대화 모델 · / });
    await main.click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${FAKE_MODEL}`) }).click();
    await expect(main).toContainText(FAKE_MODEL);
  });

  await test.step('add the model again as a named copy, on its own 설정, and make it the 보조 모델', async () => {
    await settingsPage(page, 'API 연결');
    await page.getByRole('button', { name: `${FAKE_MODEL} 추가`, exact: true }).click();
    const naming = page.getByRole('dialog', { name: `${FAKE_MODEL} 추가`, exact: true });
    const name = naming.getByLabel('이름', { exact: true });
    await expect(name).toHaveValue(`${FAKE_MODEL} 2`);
    await name.fill(COPY);
    await naming.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByRole('heading', { name: COPY, exact: true })).toBeVisible();
    await expect(page.getByText(`${COPY}용`, { exact: true })).toBeVisible();
    await settingsPage(page, '모델');
    const aux = page.getByRole('button', { name: /^보조 모델 · / });
    await aux.click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${COPY}`) }).click();
    await expect(aux).toContainText(COPY);
    await expect(page.getByRole('button', { name: /^대화 모델 · / })).not.toContainText(COPY);
  });

  await test.step('give the default persona a 별명, which lists show and no request carries', async () => {
    await settingsPage(page, '페르소나');
    await page.getByRole('button', { name: /^사용자/ }).click();
    await page.getByLabel('별명', { exact: true }).fill(NICKNAME);
    await page.getByRole('button', { name: '뒤로', exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^사용자 ${NICKNAME}`) })).toBeVisible();
    await page.getByRole('button', { name: '설정 닫기', exact: true }).click();
  });

  await test.step('import the card and see its report', async () => {
    const chooser = page.waitForEvent('filechooser');
    await pickBot(page);
    await page.getByRole('button', { name: '확인했어요', exact: true }).click();
    await (await chooser).setFiles(CARD);
    await expect(page.getByRole('dialog', { name: '가져올까요?', exact: true })).toContainText('첫인사 1개 · 로어북 1개 · 정규식 1개');
    const report = await confirmImport(page);
    await report.getByRole('button', { name: '채팅 시작', exact: true }).click();
    await expect(messages).toHaveCount(1);
    await expect(messages.first()).toContainText(GREETING);
  });

  await test.step('send "hi" and see the fake reply rendered, through the evaluation worker under the CSP', async () => {
    await page.getByLabel('메시지', { exact: true }).fill('hi');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    expect(evaluations).toContain(200);
    await expect(messages.nth(2)).toHaveText(/Mira smiles\. \(bows\)/);
    // Shown once the reply is saved and the turn is over.
    await expect(page.getByRole('button', { name: '다시 생성', exact: true })).toBeAttached();
    expect(violations).toEqual([]);
  });

  await test.step('the request carries the starter prompt, the card description and "hi" last', async () => {
    expect(sent).toHaveLength(1);
    const { model, messages: prompt } = sent[0] as { model: string; messages: { role: string; content: string }[] };
    expect(model).toBe(FAKE_MODEL);
    expect(prompt.some((message) => message.content.includes('This is private roleplay between two performers'))).toBe(true);
    expect(prompt.find((message) => message.content.includes(DESCRIPTION))?.content).toContain('(Main NPC)');
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'hi' });
    expect(JSON.stringify(sent[0])).not.toContain(NICKNAME);
  });

  await test.step('after a reload the chat, its rendered messages and the text typed but not sent are still there', async () => {
    const shown = await messages.allTextContents();
    const composer = page.getByLabel('메시지', { exact: true });
    await composer.fill('not sent yet');
    // Past the device copy's write pause.
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(messages).toHaveCount(3);
    expect(await messages.allTextContents()).toEqual(shown);
    await expect(messages.nth(0)).toContainText(GREETING);
    await expect(messages.nth(1)).toContainText('hi');
    await expect(messages.nth(2)).toContainText('Mira smiles. (bows)');
    await expect(composer).toHaveValue('not sent yet');
    await composer.fill('');
  });

  await test.step('보내기 with nothing typed asks for the next reply, whose request ends with the 응답 받기 지시 after the reply', async () => {
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(messages).toHaveCount(4);
    await expect(messages.nth(3)).toHaveText(/Mira smiles\. \(bows\)/);
    expect(sent).toHaveLength(2);
    const { messages: prompt } = sent[1] as { messages: { role: string; content: string }[] };
    expect(prompt.at(-2)?.role).toBe('assistant');
    expect(prompt.at(-1)).toEqual({ role: 'user', content: '(OOC: Continue the story with your next reply.)' });
  });

  await test.step('Ctrl+P opens the chat\'s prompt choice, whose 프롬프트 관리 opens the prompts beside the chat, a role changed there comes back with Ctrl+Z, Ctrl+F there leaves the chat\'s search closed and opens it once the panel is gone, Ctrl+/ lists every shortcut, and Ctrl+S opens and closes 설정', async () => {
    await page.keyboard.press('Control+p');
    await page.getByRole('dialog', { name: '이 채팅의 프롬프트' }).getByRole('button', { name: '프롬프트 관리' }).click();
    const side = page.getByRole('complementary', { name: '프롬프트' });
    await side.getByRole('button', { name: /기본 대화/ }).first().click();
    await side.getByRole('button', { name: /^1\. / }).click();
    const system = side.getByRole('button', { name: '시스템', exact: true });
    await expect(system).toHaveAttribute('aria-pressed', 'true');
    await side.getByRole('button', { name: '사용자', exact: true }).click();
    await expect(system).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Control+z');
    await expect(system).toHaveAttribute('aria-pressed', 'true');
    await expect(messages).toHaveCount(4);
    const chatSearch = page.getByLabel('채팅 내 검색');
    await page.keyboard.press('Control+f');
    await expect(chatSearch).toHaveCount(0);
    await side.getByRole('button', { name: '프롬프트 닫기' }).click();
    await expect(side).toBeHidden();
    await page.keyboard.press('Control+f');
    await expect(chatSearch).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(chatSearch).toHaveCount(0);
    await page.keyboard.press('Control+/');
    await expect(page.getByRole('dialog', { name: '단축키' })).toBeVisible();
    await page.keyboard.press('Escape');
    const closeSettings = page.getByRole('button', { name: '설정 닫기', exact: true });
    await page.keyboard.press('Control+s');
    await expect(closeSettings).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(closeSettings).toBeHidden();
    expect(violations).toEqual([]);
  });

  await test.step('the backup holds the card and the reply, and loading it again carries on without adding anything', async () => {
    await page.goto('/account');
    // A native save dialog does not emit Playwright's download event; this flow exercises the disk-backed OPFS path.
    await page.evaluate(() => Object.defineProperty(globalThis, 'showSaveFilePicker', { value: undefined, configurable: true }));
    const saved = page.waitForEvent('download');
    await page.getByRole('group', { name: '전체 백업' }).getByRole('button', { name: '내보내기', exact: true }).click();
    const file = await (await saved).path();
    const objects = strFromU8(unzipSync(readFileSync(file))['objects.jsonl']!);
    expect(objects).toContain(DESCRIPTION);
    expect(objects).toContain('[[bow]]');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '가져오기', exact: true }).click();
    await (await chooser).setFiles(file);
    await expect(page.getByText('백업을 가져왔어요.', { exact: true })).toBeVisible();
    expect(violations).toEqual([]);
  });

  await test.step('a bot’s HTML is drawn in its message with its CSS and pictures, and nothing in it runs, posts, loads from outside or covers the app', async () => {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await pickBot(page);
    await (await chooser).setFiles(HOSTILE);
    await (await confirmImport(page)).getByRole('button', { name: '채팅 시작', exact: true }).click();
    const greeting = messages.first();
    // The message is drawn again once its picture loads, so the rest is measured after.
    await expect(greeting.locator('#pic img')).toHaveAttribute('src', /^blob:/);
    await expect(greeting.locator('#pic img')).toHaveJSProperty('naturalWidth', 1);
    await expect(greeting.locator('#backdrop')).toHaveCSS('background-image', /^url\("blob:/);
    await expect(greeting.locator('#tone')).toHaveCSS('color', 'rgb(0, 128, 0)');
    await expect(greeting.locator('#cover')).toHaveCSS('background-color', 'rgb(200, 0, 0)');
    await expect(greeting.locator('#cover')).toHaveCSS('position', 'absolute');
    const [cover, message] = await Promise.all([greeting.locator('#cover').boundingBox(), greeting.boundingBox()]);
    expect(cover!.y).toBeGreaterThanOrEqual(message!.y);
    expect(cover!.y + cover!.height).toBeLessThanOrEqual(message!.y + message!.height);
    await expect(greeting.locator('#outside')).toHaveCount(0);
    await expect(greeting.locator('form')).toHaveCount(0);
    await expect(greeting.locator('#field')).toHaveCount(1);
    await expect(greeting.locator('#out')).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(greeting.locator('#js')).not.toHaveAttribute('href', /./);
    await expect(greeting.locator('em')).toHaveText('nods');
    await expect(greeting.locator('mark')).toHaveText('"hello"');
    await greeting.getByRole('button', { name: '누르기', exact: true }).click();
    await expect(page.getByText('아무 동작도 연결되지 않은 버튼이에요.', { exact: true })).toBeVisible();
    expect(await page.evaluate('window.ran')).toBeUndefined();
    expect(violations).toEqual([]);
  });

  await test.step('a bot’s Lua runs in its worker under the CSP: a button is answered, the bot speaks, the display follows its state, and a reply is edited once saved', async () => {
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await pickBot(page);
    await (await chooser).setFiles(SCRIPTED);
    await (await confirmImport(page)).getByRole('button', { name: '채팅 시작', exact: true }).click();
    const greeting = messages.first();
    await expect(greeting).toContainText('[door:null]');
    await greeting.getByRole('button', { name: '문 열기', exact: true }).click();
    await expect(page.getByText('문이 열렸어요', { exact: true })).toBeVisible();
    await expect(greeting).toContainText('[door:open]');
    await page.getByLabel('메시지', { exact: true }).fill('hi');
    await page.getByRole('button', { name: '보내기', exact: true }).click();
    await expect(messages.nth(2)).toContainText('Scripted smiles. [[bow]] (seen) [door:open]');
    expect(violations).toEqual([]);
  });

  await test.step('a module file becomes a module, and once always on it works on a chat already there: its display script draws and its block trigger answers a button', async () => {
    const chat = page.url();
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await pickBot(page);
    await (await chooser).setFiles(MODULE);
    await (await confirmImport(page)).getByRole('button', { name: '모듈 보기', exact: true }).click();
    // The switch shows on at once and the write lands behind it; a full navigation before it lands would lose it.
    const landed = page.waitForResponse((response) => response.url().includes('/api/objects/batch') && response.request().method() === 'POST');
    await page.getByRole('switch', { name: '항상 켜기', exact: true }).click();
    await expect(page.getByRole('switch', { name: '항상 켜기', exact: true })).toBeChecked();
    await landed;
    await page.goto(chat);
    const last = messages.nth(2);
    await expect(last).toContainText('[bell:null]');
    await last.getByRole('button', { name: '벨 울리기', exact: true }).click();
    await expect(page.getByText('따르릉', { exact: true })).toBeVisible();
    await expect(last).toContainText('[bell:2]');
    // The greeting reads the chat's current variables (design §6.8).
    await expect(messages.first()).toContainText('[bell:2]');
    expect(violations).toEqual([]);
  });

  await test.step('a large catalog windows its rows without losing search, filters, added models or ones no longer listed', async () => {
    const recorded = process.env.CATALOG_FIXTURE;
    const payload = recorded ? JSON.parse(readFileSync(recorded, 'utf8')) as typeof featherlessModels : {
      data: [
        ...Array.from({ length: 22_000 }, (_, index) => {
          const model = featherlessModels.data[index % 3]!;
          return { ...model, id: `${model.id}/sample-${index}` };
        }),
        ...featherlessModels.data,
      ],
    };
    const models = featherless.parseModels!(payload)!;
    const last = models.at(-1)!;
    let missing = false;
    const bodies: number[] = [];
    page.on('request', (request) => {
      if (!request.url().endsWith('/api/objects/batch')) return;
      const { writes } = request.postDataJSON() as { writes: { kind: string; body: string }[] };
      bodies.push(...writes.filter((write) => write.kind === 'connection').map((write) => Buffer.byteLength(write.body)));
    });
    await page.route('**/api/relay', async (route) => {
      const request = route.request().postDataJSON() as { url: string };
      await route.fulfill({ headers: { 'x-relay': 'upstream' }, json: request.url.endsWith('/models')
        ? { data: payload.data.filter((model) => !missing || model.id !== last.id) }
        : { limit: 4, used_cost: 0 } });
    });
    await page.goto('/connections/new');
    await page.getByRole('button', { name: /^Featherless/ }).click();
    await page.getByLabel('API 키', { exact: true }).fill('catalog-fixture-key');
    await page.getByRole('button', { name: '모델 선택', exact: true }).click();
    await expect(page.getByText(`모델 ${models.length}개`)).toBeVisible();
    const list = page.getByRole('list', { name: '모델', exact: true });
    const rows = list.locator(':scope > li');
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThan(100);
    await page.evaluate(`(() => {
      let frame = document.querySelector('ul[aria-label="모델"]').parentElement;
      while (frame && !/auto|scroll/.test(getComputedStyle(frame).overflowY)) frame = frame.parentElement;
      (frame ?? document.scrollingElement).scrollTop = (frame ?? document.scrollingElement).scrollHeight;
    })()`);
    await expect(page.getByRole('button', { name: `${last.name} 추가`, exact: true })).toBeVisible();
    expect(await rows.count()).toBeLessThan(100);
    const search = page.getByRole('searchbox', { name: '모델 검색' });
    await search.fill(last.id);
    await page.getByRole('button', { name: `${last.name} 추가`, exact: true }).click();
    const added = page.getByRole('list', { name: '추가한 모델', exact: true });
    await expect(added).toContainText(last.name);
    await expect(list).toContainText('추가됨');
    await search.fill('');
    await page.getByRole('button', { name: '비전', exact: true }).click();
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThan(100);
    await expect(rows.first()).toContainText('비전');
    expect(bodies).toHaveLength(2);
    expect(Math.max(...bodies)).toBeLessThan(1024);
    missing = true;
    await page.reload();
    await expect(page.getByText(`모델 ${models.length - 1}개`)).toBeVisible();
    await expect(added).toContainText('목록에 없음');
    await added.getByRole('button', { name: `${last.name} 빼기`, exact: true }).click();
    await expect(added).toHaveCount(0);
  });

  await test.step('크게 편집 draws the code editor with its own stylesheet, which the page policy admits by its nonce', async () => {
    await page.goto('/');
    await page.getByRole('complementary', { name: '캐릭터 바로가기' }).getByRole('button', { name: /^Mira/ }).first().click();
    await page.getByRole('complementary', { name: '캐릭터 목록' }).getByRole('button', { name: /^Mira/ }).first().click();
    await page.getByRole('navigation', { name: '개요' }).getByRole('button', { name: '캐릭터', exact: true }).click();
    await page.getByRole('textbox', { name: '설명' }).click();
    await page.keyboard.press('Control+Shift+X');
    await expect(page.locator('.cm-scroller')).toHaveCSS('display', 'flex');
    expect(violations).toEqual([]);
  });
});
