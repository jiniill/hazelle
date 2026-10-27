import type { Page } from '@playwright/test';
import { CARD, confirmImport, enter, pickBot } from './helpers';

// The screenshot account on the local dev server (playwright.shots.config.ts), kept across runs so a screenshot
// script signs in instead of setting up. On a .data/ with no account the first run sets the installation up, with the
// test card; that account is named owner, and the username here is the one .data/ already holds.
export const SHOTS = { username: 'shots', password: 'shots-password' };

// Set size before opening: crossing 960px remounts pages and rerolls new-chat greetings.
// Capture side-by-side panels from 1280px, overlays below, phones below 960px.
export const SIZES = { wide: { width: 1440, height: 900 }, medium: { width: 1100, height: 800 }, phone: { width: 390, height: 844 } };

// Saved as shots/out/<name>.png once menus and panels have faded in.
// Also a half-size copy in shots/out/look/, to read back: an image costs context by its pixels. It is the screenshot
// drawn again in a page of half the size, so the page shot is left as it was.
export async function snap(page: Page, name: string) {
  await page.waitForTimeout(400);
  const full = await page.screenshot({ path: `shots/out/${name}.png` });
  const { width, height } = page.viewportSize()!;
  const look = await page.context().newPage();
  await look.setViewportSize({ width: Math.round(width / 2), height: Math.round(height / 2) });
  await look.setContent(`<body style="margin:0"><img style="display:block;width:100%" src="data:image/png;base64,${full.toString('base64')}">`);
  await look.screenshot({ path: `shots/out/look/${name}.png` });
  await look.close();
}

export async function enterShots(page: Page) {
  if (!(await enter(page, SHOTS.password))) return;
  const chooser = page.waitForEvent('filechooser');
  await pickBot(page);
  await page.getByRole('button', { name: '확인했어요', exact: true }).click();
  await (await chooser).setFiles(CARD);
  await (await confirmImport(page)).getByRole('button', { name: '채팅 시작', exact: true }).click();
}
