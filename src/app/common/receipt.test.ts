import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../model/chat';
import { liveUsageLine, usageFacts, usageLine } from './receipt';

const usage = { inputTokens: 12_000, cachedInputTokens: 11_040, cacheWriteInputTokens: null, outputTokens: 678, reasoningTokens: 420 };
const receipt = { usage, cost: { unit: 'usd', amount: 0.0123, source: 'price-list' }, totalMs: 8_200, firstTextMs: 1_400, modelName: 'Sonnet 5', source: 'Anthropic' } as Receipt;

describe('사용량 표시', () => {
  it('leads the line with the cost, leaving out a cache or a cost the provider does not report', () => {
    const read = (made: Receipt) => {
      const { lead, parts } = usageLine(made);
      return [lead, parts.map(({ label, value }) => (label ? `${label} ${value}` : value)).join(' · ')];
    };
    expect(read(receipt)).toEqual(['약 $0.0123', '입력 12,000 · 출력 678 · 캐시 92% · 8.2초']);
    expect(read({ ...receipt, usage: null, cost: 'pending' })).toEqual([null, '사용량 알 수 없음 · 비용 확인하는 중… · 8.2초']);
    expect(read({ ...receipt, cost: null })[0]).toBeNull();
  });

  it('shows a reply being written by its estimated output once counted, and its whole seconds', () => {
    const read = (written: Parameters<typeof liveUsageLine>[0]) => liveUsageLine(written, 12_900).parts.map(({ label, value }) => (label ? `${label} ${value}` : value)).join(' · ');
    expect([read(null), read(1_234), read('unknown')]).toEqual(['12초', '출력 약 1,234 · 12초', '출력 알 수 없음 · 12초']);
  });

  it('opens on the facts, an unreported cache and reasoning read as unknown and an unknown cost left out', () => {
    const facts = (made: Receipt) => Object.fromEntries(usageFacts(made).map(({ label, value, notes }) => [label, [value, ...(notes ?? [])]]));
    expect(facts(receipt)).toEqual({ 입력: ['12,000', '캐시 적중 92%'], 출력: ['678', '추론 420'], 비용: ['약 $0.0123'], '걸린 시간': ['8.2초', '첫 토큰 1.4초'], 속도: ['100 tok/s'], 모델: ['Sonnet 5', 'Anthropic'] });
    expect(facts({ ...receipt, usage: { ...usage, cachedInputTokens: null, reasoningTokens: null } })).toMatchObject({ 입력: ['12,000', '캐시 적중 알 수 없음'], 출력: ['678', '추론 알 수 없음'] });
    expect(facts({ ...receipt, cost: null })).not.toHaveProperty('비용');
  });
});
