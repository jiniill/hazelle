import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FAKE_ADDRESS, FAKE_MODEL, fakeProvider, setUp, startServer, stopServer } from './helpers';

// GuideMarks must survive screen rewrites or notes dock without a target.
// Use a fresh server: the suite account's earlier reply already suppresses tutorial offers.
const PORT = 4420;
let server: ChildProcess;

test.use({ baseURL: `http://localhost:${PORT}` });
test.beforeAll(async () => {
  server = await startServer(PORT, join(tmpdir(), 'hazelle-tutorial-spec'), true);
});
test.afterAll(() => stopServer(server));

test('the tutorial points at each control in turn and ends on the chat screen', async ({ page }) => {
  await fakeProvider();
  await page.goto('/');
  await setUp(page, 'correct horse battery');
  const pointing = async (label: string, step: string) => {
    const note = page.getByRole('note', { name: label });
    await expect(note).toContainText(step);
    await expect(note.getByRole('button', { name: '이어 하기' })).toHaveCount(0);
    return note;
  };
  await page.getByRole('button', { name: /^튜토리얼 보기/ }).click();
  await page.getByRole('button', { name: /^AI 연결하고 대화 시작하기/ }).click();
  await pointing('새 연결', '1/5');
  await page.getByRole('button', { name: /^새 연결/ }).click();
  await pointing('제공자 선택', '2/5');
  await page.getByRole('button', { name: /^직접 연결/ }).click();
  await pointing('키 넣기', '3/5');
  await page.getByLabel('주소', { exact: true }).fill(FAKE_ADDRESS);
  await page.getByRole('button', { name: 'OpenAI 호환', exact: true }).click();
  await page.getByRole('button', { name: '모델 선택', exact: true }).click();
  await pointing('모델 추가', '4/5');
  await page.getByRole('button', { name: `${FAKE_MODEL} 추가`, exact: true }).click();
  const last = await pointing('대화 시작', '5/5');
  await last.getByRole('button', { name: '대화 시작하기', exact: true }).click();
  const finish = page.getByRole('dialog', { name: 'AI 연결하고 대화 시작하기' });
  await expect(finish).toContainText('튜토리얼 완료');
  await finish.getByRole('button', { name: '완료', exact: true }).click();
  await expect(finish).toBeHidden();
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Risu에서 이사/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^튜토리얼 보기/ })).toHaveCount(0);
});
