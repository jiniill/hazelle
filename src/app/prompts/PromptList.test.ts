import { expect, it } from 'vitest';
import { defaultsSummary } from './PromptList';

it('says what the closed 기본 프롬프트 fold holds and names a default that is missing', () => {
  expect(defaultsSummary([{ label: '대화', prompt: {} }, { label: '번역', prompt: {} }])).toBe('기본 프롬프트 · 대화, 번역');
  expect(defaultsSummary([{ label: '대화', prompt: {} }, { label: '번역' }, { label: '기억' }])).toBe('기본 프롬프트 · 대화 있음 · 번역, 기억 없음');
  expect(defaultsSummary([{ label: '대화' }])).toBe('기본 프롬프트 · 대화 없음');
});
