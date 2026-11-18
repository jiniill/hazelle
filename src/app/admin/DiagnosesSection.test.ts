import { expect, it } from 'vitest';
import type { AutoRow } from '../../contracts/auto-diagnosis';
import { wordsOf } from './DiagnosesSection';

it('names the latest closed cause in an app-error row, leaving pre-classification rows unclassified', () => {
  const row: AutoRow = { day: Date.parse('2026-11-02'), event: 'app-error', detail: 'TypeError', version: 'v0.6.9', place: '', people: 1, times: 1, at: 0, facts: '{"cause":"fetch"}' };
  expect(wordsOf(row).description).toBe('최근 오류 분류: fetch');
  expect(wordsOf({ ...row, facts: '{}' }).description).toBeUndefined();
});
