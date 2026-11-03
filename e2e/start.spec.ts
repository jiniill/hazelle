import { expect, test, type Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setUp, startServer, stopServer } from './helpers';

const PORT = 4421;
const KEY = 'sk-ant-api03-e2e-first-visit';
const SHOTS = process.env.START_SHOTS;
let server: ChildProcess;

test.use({ baseURL: `http://localhost:${PORT}` });
test.beforeAll(async ({ browser }) => {
  server = await startServer(PORT, join(tmpdir(), 'hazelle-start-spec'), true);
  // A hosted installation admits many accounts; at the cap of one it is one person's and greets nobody.
  const context = await browser.newContext({ baseURL: `http://localhost:${PORT}` });
  const operator = await context.newPage();
  await operator.goto('/');
  await setUp(operator, 'operator-password');
  await expect(operator.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();
  const { session } = await (await operator.request.get('/api/session')).json();
  await operator.request.put('/api/admin/service', { headers: { 'x-account': session.accountId }, data: { signupCap: 5, accountBytesCap: null, accountFileBytesCap: null } });
  await context.close();
});
test.afterAll(async () => {
  await stopServer(server);
});

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const stream = (text: string) =>
  [
    { type: 'message_start', message: { id: 'm', role: 'assistant', content: [], model: 'claude-e2e', usage: { input_tokens: 5, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('');

const sent: string[] = [];
// A guest's calls leave the page for the provider, so the fake stands in the browser, not behind the relay.
async function fakeAnthropic(page: Page) {
  await page.route('https://api.anthropic.com/**', (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (request.method() === 'POST' && request.url().includes('/messages')) sent.push(request.postData() ?? '');
    if (request.url().includes('/models')) return route.fulfill({ headers: CORS, json: { data: [{ id: 'claude-e2e', display_name: 'Claude E2E', type: 'model', max_tokens: 8192, max_input_tokens: 200000 }], has_more: false } });
    return route.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: stream('안녕하세요, 시험 답이에요.') });
  });
}

test('a first visit connects, picks, talks and finds it all in the app', async ({ page }) => {
  await fakeAnthropic(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('내 API 키로 바로 시작하는 AI 캐릭터 챗');
  if (SHOTS) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/1-hero.png` });
  }

  await page.getByRole('button', { name: '당신은 누구예요?', exact: true }).click();
  await expect(page.getByText('이제 당신 이름을 들려줄 차례예요.', { exact: false }).locator('visible=true')).toBeVisible();

  await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
  const pageLength = () => page.evaluate<number>('document.documentElement.scrollHeight');
  const lengthBefore = await pageLength();
  await page.getByLabel(/API 키$/).fill(KEY);
  await page.getByRole('button', { name: '모델 선택', exact: true }).click();
  await page.getByRole('button', { name: /Claude E2E/ }).click();
  await page.getByRole('textbox', { name: '보낼 말' }).fill('안녕');
  await page.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(page.getByText('안녕하세요, 시험 답이에요.')).toBeVisible();
  expect(sent.at(-1)).toContain('숲지기');
  expect(await pageLength()).toBe(lengthBefore);
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/4-trial.png` });
    const height = await page.evaluate<number>('document.documentElement.scrollHeight - innerHeight');
    for (const [name, at] of [['2-example', 0.2], ['3-keys', 0.38], ['5-features', 0.8], ['6-finish', 1]] as const) {
      await page.evaluate(`scrollTo(0, ${height * at})`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
    }
  }

  await page.getByRole('button', { name: '앱에서 대화 이어 가기', exact: true }).click();
  await expect(page).toHaveURL(/\/chats\//);
  await expect(page.getByText('안녕하세요, 시험 답이에요.').first()).toBeVisible();

  // The browser now holds a guest, so the front door opens the app.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: '내 API 키로 바로 시작하는 AI 캐릭터 챗' })).toHaveCount(0);
});

test('one gesture moves one stop at once, and the door looks the same on any screen', async ({ page }) => {
  const scrollTop = () => page.evaluate<number>('Math.round(scrollY)');
  const centred = (id: string) => page.evaluate<number>(`(() => { const { top, height } = document.getElementById('${id}').getBoundingClientRect(); return Math.round(top + scrollY + (height - innerHeight) / 2); })()`);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.mouse.move(400, 300);
  const example = await centred('example');

  // A flick and its inertia: one stop, not several.
  for (const delta of [120, 90, 60, 40, 25, 15, 8, 4]) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(16);
  }
  await expect.poll(scrollTop, { timeout: 5000 }).toBe(example);
  await page.waitForTimeout(400);
  expect(await scrollTop()).toBe(example);

  await page.keyboard.press('ArrowUp');
  await expect.poll(scrollTop, { timeout: 5000 }).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(scrollTop, { timeout: 5000 }).toBe(example);

  // The trial's panel must not hold the page: a notch over its fields still leaves the room.
  await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
  const room = await scrollTop();
  await page.getByLabel(/API 키$/).hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(scrollTop, { timeout: 5000 }).toBeGreaterThan(room + 500);

  // A list inside the panel scrolls first, and a flick that runs it to its end stays in the room; only a fresh notch leaves.
  await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
  const list = page.getByLabel(/API 키$/);
  await page.evaluate(`(() => {
    let scroller = document.querySelector('#trial input').parentElement;
    while (!/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    const tall = scroller.appendChild(document.createElement('div'));
    tall.style.height = '300px';
    scroller.dataset.testScroller = '';
  })()`);
  await list.hover();
  const inRoom = await scrollTop();
  for (let flick = 0; flick < 30; flick++) {
    await page.mouse.wheel(0, 60);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  expect(await scrollTop()).toBe(inRoom);
  expect(await page.evaluate<number>(`document.querySelector('[data-test-scroller]').scrollTop`)).toBeGreaterThan(0);
  await page.mouse.wheel(0, 100);
  await expect.poll(scrollTop, { timeout: 5000 }).toBeGreaterThan(inRoom + 500);

  // The canvas paints the walk, so the share it rests at is what says where the walk stands.
  const walked = async (width: number, height: number) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
    await page.waitForTimeout(500);
    return page.evaluate<number>(`Number(document.querySelector('[data-walked]').dataset.walked)`);
  };
  const [phone, desktop] = [await walked(390, 664), await walked(1440, 900)];
  expect(Math.abs(phone - desktop)).toBeLessThan(0.003);
});

test('the example conversation never moves the page, and the next notch goes on to the next stop', async ({ page }) => {
  const scrollTop = () => page.evaluate<number>('Math.round(scrollY)');
  const length = () => page.evaluate<number>('document.documentElement.scrollHeight');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, 100);
  const stop = await page.evaluate<number>(`(() => { const { top, height } = document.getElementById('example').getBoundingClientRect(); return Math.round(top + scrollY + (height - innerHeight) / 2); })()`);
  await expect.poll(scrollTop, { timeout: 5000 }).toBe(stop);
  const before = await length();
  await page.getByRole('button', { name: '당신은 누구예요?' }).click();
  for (const say of ['이름은 비밀이에요', '왜 밤에만 깨어 있어요?', '전 이제 어디로 가야 해요?']) {
    await page.getByRole('button', { name: say }).click({ timeout: 15000 });
    expect(await length()).toBe(before);
  }
  await expect(page.getByText('계속하려면 아래로')).toBeVisible({ timeout: 15000 });
  expect(await length()).toBe(before);
  expect(await scrollTop()).toBe(stop);
  const log = await page.getByText('전 이제 어디로 가야 해요?').boundingBox();
  await page.waitForTimeout(200);
  await page.mouse.move(log!.x, log!.y);
  await page.mouse.wheel(0, 100);
  await expect.poll(scrollTop, { timeout: 5000 }).toBeGreaterThan(stop + 500);
});

test('someone already using the app can walk it again and try it, uncounted, keeping nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '가입 없이 열기' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '내 API 키로 바로 시작하는 AI 캐릭터 챗' })).toHaveCount(0);
  await page.goto('/account');
  const counted: string[] = [];
  page.context().on('request', (request) => {
    if (request.url().includes('visits/first-page')) counted.push(request.url());
  });
  const opening = page.waitForEvent('popup');
  await page.getByRole('link', { name: '첫 페이지 다시 보기' }).click();
  const again = await opening;
  const heading = again.getByRole('heading', { level: 1, name: '내 API 키로 바로 시작하는 AI 캐릭터 챗' });
  await expect(heading).toBeVisible();
  await expect(again.getByRole('button', { name: '가입 없이 열기' })).toHaveCount(0);
  await fakeAnthropic(again);
  await again.evaluate(`document.getElementById('trial').scrollIntoView()`);
  await again.getByLabel(/API 키$/).fill(KEY);
  await again.getByRole('button', { name: '모델 선택', exact: true }).click();
  await again.getByRole('button', { name: /Claude E2E/ }).click();
  await again.getByRole('textbox', { name: '보낼 말' }).fill('안녕');
  await again.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(again.getByText('안녕하세요, 시험 답이에요.')).toBeVisible();
  await expect(again.getByRole('button', { name: '앱에서 대화 이어 가기' })).toHaveCount(0);
  await again.getByRole('button', { name: '앱으로 돌아가기' }).click();
  await expect(again).toHaveURL(/\/$/);
  await expect(heading).toHaveCount(0);
  expect(counted).toEqual([]);
  await expect(again.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();
});

test.describe(() => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test('one swipe moves one stop, a sideways start included, and a list inside the panel scrolls first', async ({ page }) => {
    const scrollTop = () => page.evaluate<number>('Math.round(scrollY)');
    const finger = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove', x: number, y: number) => finger.send('Input.dispatchTouchEvent', { type, touchPoints: [{ x, y }] });
    const swipeUp = async (x: number, y: number, by: number) => {
      await touch('touchStart', x, y);
      await touch('touchMove', x + 40, y);
      for (let step = 1; step <= 8; step++) {
        await touch('touchMove', x + 40, y - (by * step) / 8);
        await page.waitForTimeout(16);
      }
      await finger.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const example = await page.evaluate<number>(`(() => { const { top, height } = document.getElementById('example').getBoundingClientRect(); return Math.round(top + scrollY + (height - innerHeight) / 2); })()`);
    await swipeUp(50, 300, 160);
    await expect.poll(scrollTop, { timeout: 5000 }).toBe(example);

    await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
    await page.evaluate(`(() => {
      let scroller = document.querySelector('#trial input').parentElement;
      while (!/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      scroller.appendChild(document.createElement('div')).style.height = '300px';
      scroller.dataset.testScroller = '';
    })()`);
    const room = await scrollTop();
    const field = (await page.getByLabel(/API 키$/).boundingBox())!;
    const inner = () => page.evaluate<number>(`document.querySelector('[data-test-scroller]').scrollTop`);
    await touch('touchStart', field.x + 20, field.y + 10);
    for (let step = 1; step <= 8; step++) {
      await touch('touchMove', field.x + 20, field.y + 10 - step * 15);
      await page.waitForTimeout(16);
    }
    await finger.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(inner).toBeGreaterThan(0);
    expect(await scrollTop()).toBe(room);
  });
});

test('a phone gets the same page', async ({ page }) => {
  test.skip(!SHOTS, 'pictures only');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/p1-hero.png` });
  const height = await page.evaluate<number>('document.documentElement.scrollHeight - innerHeight');
  for (const [name, at] of [['p2', 0.2], ['p3', 0.45], ['p4', 0.65], ['p5', 1]] as const) {
    await page.evaluate(`scrollTo(0, ${height * at})`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
});

test('a refused key stays on the page and says so', async ({ page }) => {
  await page.route('https://api.anthropic.com/**', (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: CORS }) : route.fulfill({ status: 401, headers: CORS, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } })));
  await page.goto('/');
  await page.getByLabel(/API 키$/).fill(KEY);
  await page.getByRole('button', { name: '모델 선택', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: '모델 선택', exact: true })).toBeVisible();
});
