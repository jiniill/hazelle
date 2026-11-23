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

test('a veiled picture is asked for only once tapped open, stays covered until it is read, and is covered again by 가리기', async ({ page }) => {
  const failed: string[] = [];
  page.on('requestfailed', (request) => failed.push(request.url()));
  page.on('pageerror', (error) => failed.push(error.message));
  await page.goto(`${url}e2e/fixtures/veil.html`);
  const veils = page.getByRole('button', { name: '이미지 보기' });
  const pictures = page.locator('img');
  await expect(veils).toHaveCount(2);
  expect(await page.evaluate('window.asked')).toEqual([]);
  await veils.first().click();
  await expect.poll(() => page.evaluate('window.asked')).toEqual(['asset:a']);
  await expect(veils).toHaveCount(2);
  await expect(pictures).toHaveCount(0);
  await page.getByRole('button', { name: 'Read' }).click();
  await expect(pictures).toHaveCount(1);
  await expect(veils).toHaveCount(1);
  await page.getByRole('button', { name: '이미지 가리기' }).click();
  await expect(veils).toHaveCount(2);
  await expect(pictures).toHaveCount(0);
  expect(failed).toEqual([]);
});
