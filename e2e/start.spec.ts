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
  await expect(page.getByText('이제 당신 이름을 들려줄 차례예요.', { exact: false }).locator('visible=true')).toBeVisible({ timeout: 15000 });

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

// OpenRouter's sign-in page, its exchange and its API, all in the browser as a guest's calls are. The page sends the
// visitor straight back with a code, as it does once they approve.
async function fakeOpenRouter(page: Page) {
  const seen: { challenge: string | null; exchanged: { code: string; code_verifier: string }[]; said: string[] } = { challenge: null, exchanged: [], said: [] };
  await page.route('https://openrouter.ai/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/auth') {
      seen.challenge = url.searchParams.get('code_challenge');
      const back = new URL(url.searchParams.get('callback_url')!);
      back.searchParams.set('code', 'e2e-code');
      back.searchParams.set('state', url.searchParams.get('state')!);
      return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back.href)})</script>` });
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.pathname.endsWith('/auth/keys')) {
      seen.exchanged.push(request.postDataJSON());
      return route.fulfill({ headers: CORS, json: { key: 'sk-or-v1-e2e' } });
    }
    const model = (id: string, name: string, price: string) => ({ id, name, context_length: 100000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: price, completion: price }, supported_parameters: [] });
    if (url.pathname.endsWith('/models')) return route.fulfill({ headers: CORS, json: { data: [model('maker/paid', 'Paid E2E', '0.000003'), model('maker/gift', 'Gift E2E', '0')] } });
    if (url.pathname.endsWith('/key')) return route.fulfill({ headers: CORS, json: { data: { label: 'Hazelle', limit: null, limit_remaining: null, usage: 0, free_model_daily_requests: { used: 0, limit: 50, remaining: 50 } } } });
    seen.said.push(request.postData() ?? '');
    return route.fulfill({ headers: { ...CORS, 'content-type': 'text/event-stream' }, body: `data: ${JSON.stringify({ choices: [{ delta: { content: '무료로 온 답이에요.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` });
  });
  return seen;
}

test('a first visit signs in at OpenRouter instead of pasting a key, and talks on a free model', async ({ page }) => {
  const seen = await fakeOpenRouter(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
  await page.getByRole('button', { name: 'OpenRouter로 무료로 시작', exact: true }).click();

  // Back on the first page, at the key form's place, with the code gone from the address.
  const models = page.getByRole('list', { name: '모델' }).getByRole('button');
  await expect(models).toHaveCount(2);
  expect(new URL(page.url()).search).toBe('');
  await expect(models.first()).toContainText('Gift E2E');
  await expect(models.first()).toContainText('무료');
  await expect(models.last()).not.toContainText('무료');
  expect(seen.exchanged).toHaveLength(1);
  const digest = await page.evaluate<string, string>(async (verifier) => btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))), seen.exchanged[0]!.code_verifier);
  expect(digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')).toBe(seen.challenge);

  await models.first().click();
  await page.getByRole('textbox', { name: '보낼 말' }).fill('안녕');
  await page.getByRole('button', { name: '보내기', exact: true }).click();
  await expect(page.getByText('무료로 온 답이에요.')).toBeVisible();
  expect(seen.said.at(-1)).toContain('maker/gift');

  // The key is an ordinary connection's: a reload asks OpenRouter for nothing again and the app holds it.
  await page.getByRole('button', { name: '앱에서 대화 이어 가기', exact: true }).click();
  await expect(page).toHaveURL(/\/chats\//);
  expect(seen.exchanged).toHaveLength(1);

  // The same sign-in from the app's own key screen lands on the connection it made.
  await page.goto('/connections/new/openrouter');
  await page.getByRole('button', { name: 'OpenRouter 로그인으로 연결', exact: true }).click();
  await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Gift E2E').first()).toBeVisible();
  expect(seen.exchanged).toHaveLength(2);
});

// One gesture's wheel events, sent at once: awaited one by one they reach the page some 135 ms apart, and at 160 ms the
// page takes the next for a new gesture.
const flick = (page: Page, deltas: number[]) => Promise.all(deltas.map((delta) => page.mouse.wheel(0, delta)));

test('one gesture moves one stop at once, and the door looks the same on any screen', async ({ page }) => {
  const scrollTop = () => page.evaluate<number>('Math.round(scrollY)');
  const centred = (id: string) => page.evaluate<number>(`(() => { const { top, height } = document.getElementById('${id}').getBoundingClientRect(); return Math.round(top + scrollY + (height - innerHeight) / 2); })()`);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.mouse.move(400, 300);
  const example = await centred('example');

  // A flick and its inertia: one stop, not several.
  await flick(page, [120, 90, 60, 40, 25, 15, 8, 4]);
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
  // The notch's glide is let end first: still running, it carries the page off the room again under the next step.
  const rested = async () => {
    const at = await scrollTop();
    await page.waitForTimeout(200);
    return (await scrollTop()) === at;
  };
  await expect.poll(rested, { timeout: 5000 }).toBe(true);
  await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
  await expect.poll(scrollTop).toBe(room);
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
  await flick(page, Array<number>(30).fill(60));
  await page.waitForTimeout(300);  expect(await scrollTop()).toBe(inRoom);
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

test('the room lets a visitor without a key open the app', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.evaluate(`document.getElementById('trial').scrollIntoView()`);
  if (SHOTS) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOTS}/room-without-key.png` });
  }
  await page.getByRole('button', { name: '키 없이 둘러보기' }).click();
  await expect(page.getByRole('heading', { name: '비어 있어요', exact: true })).toBeVisible();
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
  await expect(again.getByRole('button', { name: '키 없이 둘러보기' })).toHaveCount(0);
  await expect(again.getByRole('button', { name: 'OpenRouter로 무료로 시작' })).toHaveCount(0);
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
