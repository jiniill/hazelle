import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let url: string;

test.beforeAll(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0 }, clearScreen: false });
  await server.listen();
  url = server.resolvedUrls!.local[0]!;
});

test.afterAll(async () => { await server?.close(); });

for (const reply of ['stay', 'follow']) {
  test(`a growing reply respects ${reply}, and explicit follow resumes tracking`, async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${url}e2e/fixtures/scroll.html?reply=${reply}`);
    const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
    const position = () => frame.evaluate((element) => ({ top: element.scrollTop, end: element.scrollHeight - element.clientHeight }));
    const atBottom = async () => expect.poll(async () => {
      const { top, end } = await position();
      return Math.abs(end - top);
    }).toBeLessThanOrEqual(1);
    await atBottom();
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(page.locator('[data-key="reply"]')).toBeAttached();
    await atBottom();
    const start = await position();
    const grow = async () => {
      await page.getByRole('button', { name: 'Grow', exact: true }).click();
      // ResizeObserver measurements and the browser's anchoring run after the DOM update.
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };
    for (let i = 0; i < 10; i++) {
      await grow();
      if (reply === 'stay') expect(Math.abs((await position()).top - start.top)).toBeLessThanOrEqual(1);
      else await atBottom();
    }
    expect((await position()).end).toBeGreaterThan(start.end + 400);
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    if (reply === 'stay') expect(Math.abs((await position()).top - start.top)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Follow', exact: true }).click();
    await atBottom();
    await grow();
    await atBottom();
    expect(errors).toEqual([]);
  });
}

test('a staying reply raises the pill under a reader at the end only once a view is unread below, and the composer growing keeps that end in view', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${url}e2e/fixtures/scroll.html?reply=stay`);
  const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
  const distance = () => frame.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
  const frames = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const pill = page.locator('output');
  const press = async (name: string) => {
    await page.getByRole('button', { name, exact: true }).click();
    await frames();
  };
  await press('Reply');
  for (let i = 0; i < 10; i++) await press('Grow');
  // Instant, as a smooth wheel would still be moving once the story grows and carry the view down on its own.
  await frame.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(pill).toHaveCount(0);
  const top = await frame.evaluate((element) => element.scrollTop);
  await press('Grow');
  await press('Finish');
  await press('Grow');
  expect(await frame.evaluate((element) => element.scrollTop)).toBe(top);
  await expect(pill).toHaveCount(0);
  await frame.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await press('Type');
  expect(await distance()).toBeLessThanOrEqual(1);
  await expect(pill).toHaveCount(0);
  const height = await frame.evaluate((element) => element.clientHeight);
  for (let grown = 0; grown <= height; grown += 100) await press('Grow');
  await expect(pill).toHaveText('맨 아래로');
  await frame.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(pill).toHaveCount(0);
  await frame.evaluate((element) => { element.scrollTop -= 300; });
  await expect(pill).toHaveText('맨 아래로');
});

test('a story drawn again, as a message flipped to its original, keeps the paragraph at the top of the view in place', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${url}e2e/fixtures/redraw.html`);
  const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
  await page.locator('[data-key="long"]').waitFor();
  const place = () => frame.evaluate((element) => {
    const paragraph = element.querySelector('[data-key="long"] div[data-buttons]')!.shadowRoot!.querySelector('[data-i="20"]')!;
    return paragraph.getBoundingClientRect().top - element.getBoundingClientRect().top;
  });
  const frames = () => page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await frame.evaluate((element) => {
    const paragraph = element.querySelector('[data-key="long"] div[data-buttons]')!.shadowRoot!.querySelector('[data-i="20"]')!;
    element.scrollTop += paragraph.getBoundingClientRect().top - element.getBoundingClientRect().top - 10;
    element.dispatchEvent(new Event('scroll'));
  });
  await frames();
  const before = await place();
  for (let round = 0; round < 2; round++) {
    await page.getByRole('button', { name: 'Flip', exact: true }).click();
    await frames();
    expect(Math.abs((await place()) - before)).toBeLessThanOrEqual(1);
  }
});

test('a view going down by itself moves at under a pixel a frame, waits on a wheel and under a finger, then goes on', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, hasTouch: true });
  await page.goto(`${url}e2e/fixtures/scroll.html?glide=8`);
  const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
  const top = () => frame.evaluate((element) => element.scrollTop);
  await frame.evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(3000);
  const read = await top();
  expect(read).toBeGreaterThan(10);
  expect(read).toBeLessThan(40);
  await frame.hover();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(500);
  const wheeled = await top();
  expect(wheeled).toBeGreaterThan(read + 200);
  await page.waitForTimeout(600);
  expect(await top()).toBe(wheeled);
  await page.waitForTimeout(2500);
  const resumed = await top();
  expect(resumed).toBeGreaterThan(wheeled + 5);
  // The finger comes down on a node that is off the page by the time it lifts, as a reply drawn again under it is.
  // As text: this file is checked against Node's types, which have no Touch.
  const finger = (type: string) => page.evaluate(`(() => {
    window.touched ??= document.querySelector('main [data-key]').appendChild(document.createElement('span'));
    const touch = new Touch({ identifier: 1, target: window.touched });
    window.touched.dispatchEvent(new TouchEvent('${type}', { bubbles: true, composed: true, changedTouches: [touch] }));
    window.touched.remove();
  })()`);
  await finger('touchstart');
  const held = await top();
  await page.waitForTimeout(2500);
  expect(await top()).toBe(held);
  await finger('touchend');
  await page.waitForTimeout(3000);
  expect(await top()).toBeGreaterThan(held + 5);
  await page.close();
});

test('a view going down by itself waits at the end, and goes on as a reply grows below a reader who stays', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(`${url}e2e/fixtures/scroll.html?reply=stay&glide=600`);
  const frame = page.locator('main > div').filter({ has: page.locator('[data-key]') });
  const position = () => frame.evaluate((element) => ({ top: element.scrollTop, end: element.scrollHeight - element.clientHeight }));
  await page.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.locator('[data-key="reply"]')).toBeAttached();
  await page.waitForTimeout(500);
  const start = await position();
  expect(start.end - start.top).toBeLessThanOrEqual(1);
  for (let i = 0; i < 10; i++) await page.getByRole('button', { name: 'Grow', exact: true }).click();
  await expect.poll(async () => {
    const { top, end } = await position();
    return end > start.end + 400 && end - top <= 1;
  }).toBe(true);
});
